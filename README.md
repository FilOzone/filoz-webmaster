# filoz-webmaster

A GitHub action that publishes a folder to Filecoin Onchain Cloud and points an ENS name at it.

On each run it:

1. Packs the folder into a CAR file and works out its IPFS root CID.
2. Stops if the ENS name already points at that CID.
3. Stores the CAR on two storage providers through the Synapse SDK, with IPFS indexing on.
4. Waits until a provider serves the new CID.
5. Sets the ENS name's contenthash to the new CID.

## Usage

```yaml
- uses: actions/checkout@v4
- uses: FilOzone/filoz-webmaster@v0
  with:
    path: site
    ens-name: example.eth
    private-key: ${{ secrets.FOC_PUBLISH_KEY }}
```

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `path` | required | Folder to publish |
| `private-key` | required | Key of the wallet that pays for storage and updates the ENS name |
| `ens-name` | empty | ENS name to point at the new CID. Empty skips the ENS update |
| `network` | `mainnet` | `mainnet` or `calibration` |
| `copies` | `2` | Number of storage providers |
| `eth-rpc-url` | `https://ethereum-rpc.publicnode.com` | Ethereum mainnet RPC for ENS |
| `verify-timeout` | `600` | Seconds to wait for a provider to serve the CID |
| `dry-run` | `false` | Pack and report the CID without uploading |

## Outputs

`cid`, `previous-cid`, `piece-cid`, `ens-tx`, `changed`.

## Wallet setup

One wallet does both jobs.

- **Storage:** it needs USDFC deposited in Filecoin Pay. The action deposits from the wallet's own USDFC balance when the account runs short, and fails if there is not enough.
- **ENS:** it must be an approved delegate for the name on the ENS Public Resolver, and hold a little ETH on Ethereum mainnet for gas. The name's owner approves it once:

  ```
  approve(bytes32 node, address delegate, bool approved)
  ```

  on the resolver, with `node` the namehash of the name.

## Development

```bash
npm ci
npm test
WEBMASTER_PATH=./some-folder WEBMASTER_DRY_RUN=true node src/main.mjs
```
