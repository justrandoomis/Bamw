/**
 * Which `/api/files/<path>` addresses the file route looks up at all.
 *
 * Letters, digits, «_» and «-» in every folder and file name, one known
 * extension, nothing else — so no «..», no encoded slash, no stray dot ever
 * reaches the bucket.
 *
 * A folder name may be up to 160 characters. A product's pictures sit in a
 * folder named by its id, and an id made from a long title is longer than the
 * 64 this used to allow: on 2026-11-05 that refused eleven square cards that
 * were in the bucket all along — Kirby and the Forgotten Land + Star-Crossed
 * World's folder is 81 characters — and their pages showed «لم يتم إضافة
 * الصورة بعد».
 */
export const SERVABLE_FILE_PATH =
  /^(?:[a-z0-9_-]{1,160}\/)*[a-z0-9_-]{1,96}\.(?:png|jpe?g|webp|gif|avif|pdf|mp4|webm|mov|weba|ogg|oga|opus|m4a|aac|mp3)$/i;

/** Whether the route should look `path` up; the key `files/<path>` stays inside storage's 512. */
export function isServableFilePath(path: string): boolean {
  return path.length <= 500 && SERVABLE_FILE_PATH.test(path);
}
