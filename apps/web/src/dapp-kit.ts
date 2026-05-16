import { createDAppKit } from '@mysten/dapp-kit-react'
import { SuiGrpcClient } from '@mysten/sui/grpc'

const TESTNET_GRPC_URL = 'https://fullnode.testnet.sui.io:443'

export const dAppKit = createDAppKit({
  networks: ['testnet'],
  createClient: (network) =>
    new SuiGrpcClient({
      network,
      baseUrl: TESTNET_GRPC_URL,
    }),
})

declare module '@mysten/dapp-kit-react' {
  interface Register {
    dAppKit: typeof dAppKit
  }
}
