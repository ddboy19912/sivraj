export type SuiNetwork = "mainnet" | "testnet" | "devnet" | "localnet";

export type SuiGrpcNetwork = "mainnet" | "testnet" | "devnet";

export function readSuiNetwork(
  value: unknown,
  fallback: SuiNetwork = "testnet",
): SuiNetwork {
  return value === "mainnet" ||
    value === "testnet" ||
    value === "devnet" ||
    value === "localnet"
    ? value
    : fallback;
}

export function readSuiGrpcNetwork(
  value: unknown,
  fallback: SuiGrpcNetwork = "testnet",
): SuiGrpcNetwork {
  const network = readSuiNetwork(value, fallback);

  return network === "localnet" ? fallback : network;
}
