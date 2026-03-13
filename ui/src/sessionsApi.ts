import { apiPost } from "./api";

export async function apiDelete(path: string, token: string): Promise<void> {
  // Reuse apiPost with an empty body for DELETE to inherit error handling and notifications.
  await fetch(path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token), {
    method: "DELETE",
  }).then(async (res) => {
    if (!res.ok) {
      // Let apiPost handle error classification and notifications.
      await apiPost(path, token, {}); // This will always fail but will parse and emit the right notifications.
    }
  });
}

