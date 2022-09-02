# DXswap Core Contracts

DXswap core is a fork of the [Uniswapv2 core smart contracts v1.0.0](https://github.com/Uniswap/uniswap-v2-core/releases/tag/v1.0.0).

## Local Development

The following assumes the use of `node@>=10`.

## Clone Repository

`git clone https://github.com/levelkdev/dxswap-core.git`

## Install Dependencies

`yarn`

## Compile Contracts

`yarn compile`

## Run Tests

`yarn test`

## Flatten Contracts

`yarn flattener`

## Deployment

Add `PRIVATE_KEY` of deployer to `.env`

```shell
echo "PRIVATE_KEY=<private-key>" > .env
```

Deploy to target network. Make sure its configuration exists in `hardhat.config.ts`

```shell
hardhat run --network gnosis scripts/deploy.ts
```
