/**
 * What the admin's contest screens receive — shared by `/api/admin/contests`
 * and the panel that reads it, so the two cannot drift apart.
 */
import type {
  ContestDrawProof,
  ContestDrawSource,
  ContestEntryMethod,
  ContestPhase,
  ContestSettings,
  ContestStatus,
} from "./contests";
import type { IgRejection } from "./instagramComments";

export interface AdminContestRow {
  id: string;
  title: string;
  status: ContestStatus;
  phase: ContestPhase;
  drawSource: ContestDrawSource;
  prizeTitle: string;
  prizeImage: string;
  startsAt: string;
  endsAt: string;
  tickets: number;
  participants: number;
  createdAt: string;
}

export interface AdminContestEntry {
  id: string;
  userId: string;
  name: string;
  username: string | null;
  method: ContestEntryMethod;
  entryNo: number;
  ticketCode: string | null;
  bananas: number;
  removedAt: string | null;
  removedReason: string | null;
  createdAt: string;
}

export interface AdminContestTicket {
  code: string;
  note: string | null;
  createdAt: string;
  redeemedBy: string | null;
  redeemedAt: string | null;
  revokedAt: string | null;
}

export interface AdminContestWinner {
  id: string;
  position: number;
  alternate: boolean;
  status: "pending" | "confirmed" | "standby" | "disqualified";
  source: "site" | "instagram";
  entryNo: number | null;
  userId: string | null;
  name: string | null;
  instagramUsername: string | null;
  comment: string | null;
  claimCode: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  prizeId: string | null;
  note: string | null;
}

export interface AdminContestDetail {
  contest: {
    id: string;
    status: ContestStatus;
    phase: ContestPhase;
    settings: ContestSettings;
    proof: ContestDrawProof | null;
    createdAt: string;
    drawnAt: string | null;
    closedAt: string | null;
  };
  stats: {
    tickets: number;
    participants: number;
    byMethod: Partial<Record<ContestEntryMethod, number>>;
    ticketsCreated: number;
    ticketsRedeemed: number;
  };
  entries: AdminContestEntry[];
  tickets: AdminContestTicket[];
  winners: AdminContestWinner[];
  instagram: {
    configured: boolean;
    comments: number;
    fetchedAt: string | null;
    complete: boolean;
  };
}

export interface InstagramPreview {
  stats: {
    comments: number;
    accounts: number;
    qualifiedComments: number;
    qualifiedAccounts: number;
    duplicatesDropped: number;
    rejected: Partial<Record<IgRejection, number>>;
  };
  sample: { username: string; comment: string; mentions: number; comments: number }[];
}
