import { vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  walletState: {
    account: null as { address: string } | null,
    wallet: null as { name: string } | null,
    network: 'testnet',
    signPersonalMessage: vi.fn(),
  },
}))

export const walletState = hoisted.walletState

vi.mock('@mysten/dapp-kit-react', () => ({
  useCurrentAccount: () => walletState.account,
  useCurrentWallet: () => walletState.wallet,
  useCurrentNetwork: () => walletState.network,
  useWalletConnection: () => ({
    account: walletState.account,
    isConnecting: false,
    isReconnecting: false,
  }),
  useDAppKit: () => ({
    signPersonalMessage: walletState.signPersonalMessage,
  }),
}))

vi.mock('@mysten/dapp-kit-react/ui', () => ({
  ConnectButton: () => <button type="button">Connect wallet</button>,
}))

vi.mock('@mysten/seal', () => ({
  SealClient: class {
    async encrypt() {
      return {
        encryptedObject: new TextEncoder().encode('encrypted-client-payload'),
      }
    }
  },
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}))
