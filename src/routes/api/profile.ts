import { createFileRoute } from "@tanstack/react-router";

import { randomId } from "@/lib/crypto.server";
import { findUserByUsername, getUsers, toPublicUser, updateUser } from "@/lib/db.server";
import { body, guard, json } from "@/lib/http.server";
import {
  readNotificationPreferences,
  sanitizeNotificationPreferences,
} from "@/lib/notification-preferences";
import { requireUser } from "@/lib/session.server";
import type { Address, Gender, UserSettings } from "@/lib/types";

interface ProfileBody {
  name?: string;
  username?: string;
  email?: string;
  gender?: Gender;
  birthDate?: string;
  preferredGenres?: string[];
  /** set by the optional signup steps so they never show again */
  profileCompleted?: boolean;
  phone?: string;
  avatar?: string;
  settings?: Partial<UserSettings>;
  favoriteToggle?: string | number;
  address?: Partial<Address> & { id?: string };
  removeAddressId?: string;
  defaultAddressId?: string;
  telegramId?: string;
  friendId?: string;
}

export const Route = createFileRoute("/api/profile")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        guard(async () => {
          const current = await requireUser(request);
          const data = await body<ProfileBody>(request);

          // Account identities are security credentials and may only change
          // through their verified ownership flows. In particular, accepting
          // an arbitrary owner email here makes later privilege checks unsafe.
          if (
            data.phone !== undefined ||
            data.telegramId !== undefined ||
            data.email !== undefined
          ) {
            return json(
              { error: "استخدم مسار التحقق لتغيير رقم الهاتف أو البريد أو تلغرام" },
              { status: 400 },
            );
          }
          if (data.name !== undefined && String(data.name).trim().length > 80) {
            return json({ error: "الاسم طويل جداً" }, { status: 400 });
          }
          if (
            data.avatar !== undefined &&
            data.avatar !== "" &&
            (!data.avatar.startsWith(`/api/files/avatars/${current.id}/`) ||
              !/^\/api\/files\/avatars\/[a-z0-9_]+\/[a-z0-9_-]+\.(?:png|jpe?g|webp|gif)$/i.test(
                data.avatar,
              ))
          ) {
            return json({ error: "صورة الحساب غير صالحة" }, { status: 400 });
          }

          // Public handle and email stay unique across members.
          let username: string | undefined;
          if (data.username !== undefined) {
            username = String(data.username).trim().replace(/^@/, "").toLowerCase();
            if (username) {
              if (!/^[a-z0-9_.]{3,20}$/.test(username)) {
                return json(
                  { error: "المعرّف يجب أن يكون 3-20 حرفاً إنجليزياً أو رقماً" },
                  { status: 400 },
                );
              }
              const taken = await findUserByUsername(username);
              if (taken && taken.id !== current.id) {
                return json({ error: "هذا المعرّف مستخدم مسبقاً" }, { status: 409 });
              }
            }
          }

          const updated = await updateUser(current.id, (user) => {
            let addresses = user.addresses;

            if (data.address) {
              const id = data.address.id ?? randomId("adr");
              const entry: Address = {
                id,
                label: data.address.label ?? "عنواني",
                fullName: data.address.fullName ?? user.name,
                phone: data.address.phone ?? user.phone ?? "",
                city: data.address.city ?? "",
                ...(data.address.area ? { area: data.address.area } : {}),
                ...(data.address.street ? { street: data.address.street } : {}),
                ...(data.address.notes ? { notes: data.address.notes } : {}),
                isDefault: data.address.isDefault ?? addresses.length === 0,
              };
              addresses = addresses.some((a) => a.id === id)
                ? addresses.map((a) => (a.id === id ? entry : a))
                : [...addresses, entry];
              if (entry.isDefault) {
                addresses = addresses.map((a) => ({ ...a, isDefault: a.id === id }));
              }
            }

            if (data.removeAddressId) {
              addresses = addresses.filter((a) => a.id !== data.removeAddressId);
            }

            if (data.defaultAddressId) {
              addresses = addresses.map((a) => ({
                ...a,
                isDefault: a.id === data.defaultAddressId,
              }));
            }

            const favorites =
              data.favoriteToggle === undefined
                ? user.favorites
                : user.favorites.some((f) => String(f) === String(data.favoriteToggle))
                  ? user.favorites.filter((f) => String(f) !== String(data.favoriteToggle))
                  : [...user.favorites, data.favoriteToggle];

            return {
              ...user,
              ...(data.name ? { name: String(data.name).trim() } : {}),
              ...(username ? { username } : {}),
              ...(data.gender ? { gender: data.gender } : {}),
              ...(data.birthDate !== undefined ? { birthDate: data.birthDate } : {}),
              ...(data.preferredGenres
                ? { preferredGenres: data.preferredGenres.filter((g) => typeof g === "string") }
                : {}),
              ...(data.profileCompleted && !user.profileCompletedAt
                ? { profileCompletedAt: new Date().toISOString() }
                : {}),
              ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
              /*
                Notification preferences are the three switchable booleans and
                nothing else. This merge is wholesale, so without the filter a
                client could store any shape it liked under `notifications` —
                and `readNotificationPreferences` would have to keep defending
                against it on every send.
              */
              settings: {
                ...user.settings,
                ...(data.settings ?? {}),
                ...(data.settings?.notifications !== undefined
                  ? {
                      notifications: {
                        ...readNotificationPreferences(user.settings),
                        ...sanitizeNotificationPreferences(data.settings.notifications),
                      },
                    }
                  : {}),
              },
              addresses,
              favorites,
              ...(data.friendId !== undefined ? { friendId: data.friendId } : {}),
            };
          });

          return json({ user: updated ? toPublicUser(updated) : null });
        }),
    },
  },
});
