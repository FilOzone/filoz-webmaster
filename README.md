# filoz-webmaster

A GitHub action that publishes a folder to Filecoin Cloud and points an ENS name, a DNSLink record, or both at it.

On each run it:

1. Packs the folder into a CAR file and works out its IPFS root CID.
2. Stops if every target (the ENS name, the DNSLink record) already points at that CID.
3. Stores the CAR on two storage providers through the Synapse SDK, with IPFS indexing on. If the wallet's providers already serve the CID, the upload is skipped.
4. Waits until a provider serves the new CID.
5. Sets the DNSLink TXT record to the new CID.
6. Sets the ENS name's contenthash to the new CID.

Both targets are optional. With neither, the action only uploads. A target that already points at the CID is left alone, so a failed run can be re-run: it stores nothing twice and updates only what is behind.

## Usage

```yaml
- uses: actions/checkout@v4
- uses: FilOzone/filoz-webmaster@v0
  with:
    path: site
    ens-name: example.eth
    private-key: ${{ secrets.FOC_PUBLISH_KEY }}
```

For a site on a DNS name in a Cloudflare zone:

```yaml
- uses: actions/checkout@v4
- uses: FilOzone/filoz-webmaster@v0
  with:
    path: site
    dnslink-name: site.example.com
    cloudflare-api-token: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    cloudflare-zone-id: ${{ vars.CLOUDFLARE_ZONE_ID }}
    private-key: ${{ secrets.FOC_PUBLISH_KEY }}
```

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `path` | required | Folder to publish |
| `private-key` | required | Key of the single wallet that pays for storage (via Filecoin Pay) and updates the ENS name. It needs USDFC and, for ENS, ETH and delegate approval; see [Wallet setup](#wallet-setup) |
| `ens-name` | empty | ENS name to point at the new CID. Empty skips the ENS update |
| `dnslink-name` | empty | DNS name to point at the new CID, with or without the `_dnslink.` label. Empty skips the DNSLink update |
| `cloudflare-api-token` | empty | Cloudflare API token for the DNSLink update; see [DNSLink setup](#dnslink-setup) |
| `cloudflare-zone-id` | empty | ID of the Cloudflare zone that holds `dnslink-name` |
| `network` | `mainnet` | `mainnet` or `calibration` |
| `copies` | `2` | Number of storage providers |
| `eth-rpc-url` | `https://ethereum-rpc.publicnode.com` | Ethereum mainnet RPC for ENS |
| `verify-timeout` | `600` | Seconds to wait for a provider to serve the CID |
| `dry-run` | `false` | Pack and report the CID without uploading |

## Outputs

`cid`, `previous-cid` (ENS), `dnslink-previous-cid`, `piece-cid`, `ens-tx`, `changed`.

## Wallet setup

One wallet does both jobs.

- **Storage:** it needs USDFC deposited in Filecoin Pay. The action deposits from the wallet's own USDFC balance when the account runs short, and fails if there is not enough.
- **ENS:** it must be an approved delegate for the name on the ENS Public Resolver, and hold a little ETH on Ethereum mainnet for gas. The name's owner approves it once:

  ```
  approve(bytes32 node, address delegate, bool approved)
  ```

  on the resolver, with `node` the namehash of the name.

## DNSLink setup

The DNS zone must be on Cloudflare.

- Create an API token with the DNS Write permission, limited to the one zone, and store it as a secret.
- The zone ID is on the domain's Overview page in the Cloudflare dashboard.

The action sets the TXT record `_dnslink.<name>` to `dnslink=/ipfs/<cid>` with a TTL of 300 seconds. It updates the record in place, creates it when the name has none, and fails if the name has more than one DNSLink record. A dry run without the token skips the DNSLink read.

## Development

```bash
npm ci
npm test
WEBMASTER_PATH=./some-folder WEBMASTER_DRY_RUN=true node src/main.mjs
```
