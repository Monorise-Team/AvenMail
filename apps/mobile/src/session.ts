import * as SecureStore from "expo-secure-store";

/** Token logowania w systemowym sejfie telefonu (Keychain na iOS, Keystore na Androidzie), ADR-0089. */
const KEY = "aven-mobile-token";

export const readToken = (): Promise<string | null> => SecureStore.getItemAsync(KEY);

export async function writeToken(token: string | null): Promise<void> {
  if (token) await SecureStore.setItemAsync(KEY, token);
  else await SecureStore.deleteItemAsync(KEY);
}
