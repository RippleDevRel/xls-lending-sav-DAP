import { Client } from "xrpl";
import { XRPL_NETWORK_URL } from "@/lib/constants";

let clientInstance: Client | null = null;

export async function getXrplClient(): Promise<Client> {
  if (!clientInstance || !clientInstance.isConnected()) {
    clientInstance = new Client(XRPL_NETWORK_URL);
    await clientInstance.connect();
  }
  return clientInstance;
}

export async function disconnectXrplClient(): Promise<void> {
  if (clientInstance?.isConnected()) {
    await clientInstance.disconnect();
    clientInstance = null;
  }
}
