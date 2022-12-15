import glob from "glob-promise";
import { existsSync, promises } from "fs";
import { join, parse, resolve } from "path";
import { exec } from "child_process";
const { mkdir, readdir, readFile, writeFile, copyFile, rmdir } = promises;

const ROOT = join(__dirname, "..");

// TYPES
export type ContractsAddresses = {
    [chainId: string]: {
        [contractName: string]: string;
    };
};

// CONFIG
const config = {
    paths: {
        outDir: join(ROOT, "bundle/dxswap-core"), // Path to root folder
        deployments: join(ROOT, "deployments"), // Path to folder with deployments (compatible with hardhat-deploy only)
        artifacts: join(ROOT, "build/artifacts"), // Path to folder with artifacts to be copied
    },
    addresses: {
        fileName: "addresses", // Name of the file to which addresses will be saved in .json format
        ignoredDeployments: [
            // Array of deployments (chains) that will be ignored
            "localhost",
            "hardhat",
        ],
        includedContracts: [
            // Name of contracts (will match filename) to be included in .json with addresses
            "DXswapFactory",
            "DXswapFeeReceiver",
            "DXswapFeeSetter",
            "DXswapDeployer",
        ],
    },
    artifacts: {
        dirName: "artifacts", // Name of folder to which artifacts will be saved
        includedContracts: [
            // Name of contracts (will match filename) to be included in artifacts bundle
            "DXswapFactory",
            "DXswapFeeReceiver",
            "DXswapFeeSetter",
            "DXswapDeployer",
        ],
    },
    chains: {
        // chain name => networkId mapping used to build enum
        rinkeby: 4,
        gnosis: 100,
    },
};

// UTILS
const camelize = (str: string) => {
    return str
        .replace(/(?:^\w|[A-Z]|\b\w)/g, (word: string, index: number) => {
            return index === 0 ? word.toLowerCase() : word.toUpperCase();
        })
        .replace(/\s+/g, "");
};

const copyFiles = async (paths: string[], outDir: string) => {
    for (const path of paths) {
        await copyFile(path, join(outDir, parse(path).base));
    }
};

const recreateDirs = async (paths: string[]) => {
    for (const path of paths) {
        const exists = existsSync(path);

        if (exists) {
            await rmdir(path, {
                recursive: true,
            });
        }

        await mkdir(path, {
            recursive: true,
        });
    }
};

const log = (msg: string) => console.log("\x1b[32m%s\x1b[0m", msg);

const execAsync = (cmd: string) => {
    return new Promise((resolve) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.warn(error);
            }
            resolve(stdout ? stdout : stderr);
        });
    });
};

// BUNDLERS
const bundleAddresses = async () => {
    const addresses: ContractsAddresses = {};
    const deployments = await readdir(config.paths.deployments);

    for (const deployment of deployments) {
        let chainId: string;

        if (!config.addresses.ignoredDeployments.includes(deployment)) {
            const deploymentContent = await readdir(
                join(config.paths.deployments, deployment)
            );

            if (deploymentContent.includes(".chainId")) {
                chainId = (
                    await readFile(
                        join(config.paths.deployments, deployment, ".chainId")
                    )
                ).toString();
            } else {
                throw new Error(
                    `Missing ${join(
                        config.paths.deployments,
                        deployment,
                        ".chainId"
                    )}`
                );
            }

            for (const fileName of deploymentContent) {
                const filePath = join(
                    config.paths.deployments,
                    deployment,
                    fileName
                );
                const file = parse(filePath);

                if (
                    file.ext === ".json" &&
                    config.addresses.includedContracts.includes(file.name)
                ) {
                    const fileContent = (
                        await readFile(
                            join(config.paths.deployments, deployment, fileName)
                        )
                    ).toString();
                    const addressSearch = fileContent.match(
                        /(?<="address": ")[\w\d]*/g
                    );

                    if (addressSearch && addressSearch.length > 0) {
                        if (!addresses[chainId]) {
                            addresses[chainId] = {};
                        }
                        addresses[chainId][camelize(file.name)] =
                            addressSearch[0];
                    }
                }
            }
        }
    }

    if (Object.keys(addresses).length > 0) {
        const subfolders = ["src", "dist"];

        for (const subfolder of subfolders) {
            await writeFile(
                join(
                    join(config.paths.outDir, subfolder),
                    `${config.addresses.fileName}.json`
                ),
                JSON.stringify(addresses),
                {}
            );
        }
    }
};

const bundleArtifacts = async () => {
    const artifactsOutDir = join(config.paths.outDir, config.artifacts.dirName);
    const includedFiles = config.artifacts.includedContracts.join("|");

    const artifacts = await glob(
        `${config.paths.artifacts}/**/@(${includedFiles}).json`,
        {
            cwd: resolve(__dirname),
        }
    );

    for (const artifact of artifacts) {
        const contractProps = parse(artifact);

        await copyFile(artifact, join(artifactsOutDir, contractProps.base));
    }
};

const createIndexFile = async () => {
    // Write imports
    const writeImports = [
        `import * as addresses from './${config.addresses.fileName}.json';`,
    ].join("\n\t");

    // Write reexports
    const writeReexports = [
        `export * from './typechain/index';`,
        `export * from './encoders';`,
    ].join("\n\t");

    // Write ContractAddresses interface
    const artifacts = await glob(
        `${join(config.paths.outDir, config.artifacts.dirName)}/*.json`,
        {
            cwd: resolve(__dirname),
        }
    );

    const artifactsNames = artifacts
        .reduce<string[]>((total, filepath) => {
            let name = parse(filepath).name;

            if (config.addresses.includedContracts.includes(name)) {
                total.push(`${camelize(name)}: string;`);
            }

            return total;
        }, [])
        .join("\n\t\t");

    const writeContractAddressInterface = `export interface ContractAddresses {
        ${artifactsNames}
    }`;

    // Write ChainId enum
    const chains = Object.keys(config.chains)
        .map((chainName) => {
            return `${chainName.toLowerCase()} = ${
                config.chains[chainName as keyof typeof config.chains]
            },`;
        })
        .join("\n\t\t");

    const writeChainEnum = `export enum ChainId {
        ${chains}
    }`;

    // Write function
    const writeFunction = `
    /**
     * Used to get addresses of contracts that have been deployed to either the
     * Ethereum mainnet or a supported testnet. Throws if there are no known
     * contracts deployed on the corresponding chain.
     * @param chainId The desired chainId.
     * @returns The set of addresses for contracts which have been deployed on the
     * given chainId.
     */
    export function getContractAddressesForChainOrThrow(chainId: ChainId): ContractAddresses {
        const chainToAddresses: { [chainId: number]: ContractAddresses } = addresses;
    
        if (chainToAddresses[chainId] === undefined) {
            throw new Error(\`Unknown chain id (\${chainId}). No known aqua contracts have been deployed on this chain.\`);
        }
        return chainToAddresses[chainId];
    }
    `;

    // Create and write index.ts
    const writeIndexFile = `
    /*eslint-disable */
    // @ts-nocheck
    // Inspired by https://github.com/0xProject/protocol/tree/main/packages/contract-addresses

    ${writeImports}

    ${writeReexports}

    ${writeContractAddressInterface}

    ${writeChainEnum}

    ${writeFunction}
    `;

    await writeFile(
        join(config.paths.outDir, "src", "index.ts"),
        writeIndexFile
    );
};

const run = async () => {
    log(`Aqua-sc bundler`);
    log("=====================");
    log("Cleaning old files...");
    await recreateDirs([
        join(config.paths.outDir, "src"),
        join(config.paths.outDir, "dist"),
        join(config.paths.outDir, "artifacts"),
    ]);
    log("Compiling contracts...");
    await execAsync("yarn compile");
    log("Bundling addresses...");
    await bundleAddresses();
    log("Bundling artifacts...");
    await bundleArtifacts();
    log("Creating index.ts...");
    await createIndexFile();
    log("Running typechain...");
    const typechainSrc = join(config.paths.outDir, "src", "typechain");
    await execAsync(
        `yarn typechain --target ethers-v5 --out-dir ${typechainSrc} '${join(
            config.paths.outDir,
            config.artifacts.dirName
        )}/*.json'`
    );
    log("Running tsc...");
    await execAsync(
        `tsc --declaration true --outDir ${join(
            config.paths.outDir,
            "dist"
        )} ${join(config.paths.outDir, "src", "*.ts")}`
    );
    const declarationFiles = await glob(`${typechainSrc}/*.d.ts`, {
        cwd: resolve(__dirname),
    });
    await copyFiles(
        declarationFiles,
        join(config.paths.outDir, "dist", "typechain")
    );
    log("=====================");
    log(`Bundle successfully created in '${config.paths.outDir}' folder.`);
};

run();
