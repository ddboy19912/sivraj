import { SuiGrpcClient } from "@mysten/sui/grpc";

const DEFAULT_TESTNET_GRPC_URL = "https://fullnode.testnet.sui.io:443";

let authClient: SuiGrpcClient | null = null;

export function getSuiAuthClient(env: Record<string, string | undefined>) {
  if (authClient) {
    return authClient;
  }

  authClient = new SuiGrpcClient({
    network: readSuiNetwork(env["SUI_NETWORK"]),
    baseUrl: env["SUI_RPC_URL"] || DEFAULT_TESTNET_GRPC_URL,
  });

  return authClient;
}

function readSuiNetwork(value: string | undefined) {
  if (value === "mainnet" || value === "testnet" || value === "devnet") {
    return value;
  }

  return "testnet";
}
