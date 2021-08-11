import {TokenInstructions} from '@project-serum/token';
import {TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {
  AccountInfo,
  AccountMeta,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  StakeProgram,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  TransactionInstruction,
} from '@solana/web3.js';
import assert from 'assert';
import BN from 'bn.js';
import * as BufferLayout from 'buffer-layout';
import {getState} from './example_client.js';
import {
  getParsedStakingAccount,
  JsonParsedNativeStakeAccount,
} from './parrot.js';

import * as schema from './schema.js';

const STAKE_STATE_LEN = 200;
const MIN_STAKE_BALANCE_LAMPORTS = 1 * LAMPORTS_PER_SOL;

function bnToU64Buffer(bn: BN) {
  const b = Buffer.from(bn.toArray().reverse());
  if (b.length === 8) {
    return b;
  }
  assert(b.length < 8, 'u64 too large');

  const zeroPad = Buffer.alloc(8);
  b.copy(zeroPad);
  return zeroPad;
}

const AUTHORITY_DEPOSIT = 'deposit';
const AUTHORITY_WITHDRAW = 'withdraw';

export async function createDepositStakeInstructionsWithConnection(
  conn: Connection,
  programId: PublicKey,
  stakePoolAddress: PublicKey,
  stakeAccount: PublicKey, //it's delegate vote account must in pool
  voteAccountAddress: PublicKey, //this can be read from stake account, now just for simplicity
  owner: PublicKey,
  tokenReceiver: PublicKey, //user associated pool mint account
  referralFeeReceiver: PublicKey, //can be any meet the pool mint
): Promise<TransactionInstruction[]> {
  const poolState: schema.StakePool = schema.StakePool.decodeUnchecked(
    ((await conn.getAccountInfo(stakePoolAddress)) as AccountInfo<Buffer>).data,
  );
  const [validatorStakeAccountAddress, _] = await findStakeProgramAddress(
    programId,
    voteAccountAddress,
    stakePoolAddress,
  );
  return createDepositStakeInstructions(
    programId,
    stakePoolAddress,
    stakeAccount,
    {
      stakeAccountAuthority: owner,
      validatorListStorage: poolState.validatorList,
      validatorStakeAccount: validatorStakeAccountAddress,
      reserveStakeAccount: poolState.reserveStake,
      tokenReceiver: tokenReceiver,
      managerFeeReceiver: poolState.managerFeeAccount,
      referralFeeReceiver,
      tokenMint: poolState.poolMint,
    },
  );
}

export async function createDepositStakeInstructions(
  programId: PublicKey,
  stakePoolAddress: PublicKey,
  stakeAccount: PublicKey, //it's delegate vote account must in pool
  optional: {
    stakeAccountAuthority: PublicKey; // stake or withdraw authority (usually owner)
    validatorListStorage: PublicKey;
    validatorStakeAccount: PublicKey;
    reserveStakeAccount: PublicKey;
    tokenReceiver: PublicKey; // if not provided, associated token account used
    managerFeeReceiver: PublicKey;
    referralFeeReceiver: PublicKey;
    tokenMint: PublicKey;
  },
): Promise<TransactionInstruction[]> {
  const [stakePoolDepositAuthority, _] = await PublicKey.findProgramAddress(
    [stakePoolAddress.toBuffer(), Buffer.from(AUTHORITY_DEPOSIT)],
    programId,
  );
  const [stakePoolWithdrawAuthority, __] = await PublicKey.findProgramAddress(
    [stakePoolAddress.toBuffer(), Buffer.from(AUTHORITY_WITHDRAW)],
    programId,
  );

  const ixs: TransactionInstruction[] = [
    ...StakeProgram.authorize({
      stakePubkey: stakeAccount,
      authorizedPubkey: optional.stakeAccountAuthority,
      newAuthorizedPubkey: stakePoolDepositAuthority,
      stakeAuthorizationType: {index: 0}, //staker
    }).instructions,
    ...StakeProgram.authorize({
      stakePubkey: stakeAccount,
      authorizedPubkey: optional.stakeAccountAuthority,
      newAuthorizedPubkey: stakePoolDepositAuthority,
      stakeAuthorizationType: {index: 1}, //withdrawer
    }).instructions,
    new TransactionInstruction({
      keys: [
        {pubkey: stakePoolAddress, isWritable: true, isSigner: false},
        {
          pubkey: optional.validatorListStorage,
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: stakePoolDepositAuthority,
          isWritable: false,
          isSigner: false,
        },
        {
          pubkey: stakePoolWithdrawAuthority,
          isWritable: false,
          isSigner: false,
        },
        {pubkey: stakeAccount, isWritable: true, isSigner: false},
        {
          pubkey: optional.validatorStakeAccount,
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: optional.reserveStakeAccount,
          isWritable: true,
          isSigner: false,
        },
        {pubkey: optional.tokenReceiver, isWritable: true, isSigner: false},
        {
          pubkey: optional.managerFeeReceiver,
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: optional.referralFeeReceiver,
          isWritable: true,
          isSigner: false,
        }, // error here
        {
          pubkey: optional.tokenMint,
          isWritable: true,
          isSigner: false,
        },
        {pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false},
        {
          pubkey: SYSVAR_STAKE_HISTORY_PUBKEY,
          isWritable: false,
          isSigner: false,
        },
        {pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false},
        {
          pubkey: StakeProgram.programId,
          isWritable: false,
          isSigner: false,
        },
      ],
      programId: programId,
      data: Buffer.from([10]), //deposit
    }),
  ];

  return ixs;
}

export const uint64 = (property = 'uint64'): Record<string, unknown> => {
  return BufferLayout.blob(8, property);
};


export async function createDepositSOLInstructionsWithConnection(
  conn: Connection,
  programId: PublicKey,
  stakePoolAddress: PublicKey,
  lamportsToDeposit: BN,
  owner: PublicKey,
  userPoolTokenAccount: PublicKey, //user associated pool mint account
  referrerPoolTokenAccount: PublicKey,
) {
  const {pool, validatorList} = await getState(conn, stakePoolAddress);

  const userSolTransfer = Keypair.generate();
  const signers = [userSolTransfer];
  const [stakePoolWithdrawAuthority, _] = await PublicKey.findProgramAddress(
    [stakePoolAddress.toBuffer(), Buffer.from(AUTHORITY_WITHDRAW)],
    programId,
  );

  const ixs: TransactionInstruction[] = [];
  ixs.push(
    SystemProgram.transfer({
      fromPubkey: owner,
      toPubkey: userSolTransfer.publicKey,
      lamports: lamportsToDeposit.toNumber(),
    }),
  );

  const dataLayout = BufferLayout.struct([
    BufferLayout.u8('instruction'),
    uint64('amount'),
  ]);

  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      instruction: 15, // DepositSol
      amount: bnToU64Buffer(lamportsToDeposit),
    },
    data,
  );
  ixs.push(
    new TransactionInstruction({
      programId: programId,
      keys: [
        {pubkey: stakePoolAddress, isWritable: true, isSigner: false},
        {
          pubkey: stakePoolWithdrawAuthority,
          isWritable: false,
          isSigner: false,
        },
        {pubkey: pool.reserveStake, isWritable: true, isSigner: false},
        {pubkey: userSolTransfer.publicKey, isWritable: true, isSigner: true},
        {pubkey: userPoolTokenAccount, isWritable: true, isSigner: false},
        {pubkey: pool.managerFeeAccount, isWritable: true, isSigner: false},
        {pubkey: referrerPoolTokenAccount, isWritable: true, isSigner: false},
        {pubkey: pool.poolMint, isWritable: true, isSigner: false},
        {pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false},
        {pubkey: SystemProgram.programId, isWritable: false, isSigner: false},
        {pubkey: pool.tokenProgramId, isWritable: false, isSigner: false},
      ],
      data: data,
    }),
  );

  return {ixs, signers};
}

export async function createWithdrawInstructionsWithConnection(
  conn: Connection,
  programId: PublicKey,
  stakePoolAddress: PublicKey,
  poolAmount: BN,
  owner: PublicKey,
  poolTokenAccount: PublicKey //user associated pool mint account
) {
  const poolState: schema.StakePool = schema.StakePool.decodeUnchecked(
    ((await conn.getAccountInfo(stakePoolAddress)) as AccountInfo<Buffer>).data
  );
  return createWithdrawInstructions(
    conn,
    programId,
    stakePoolAddress,
    poolAmount,
    poolState,
    poolTokenAccount,
    owner
  );
}

export async function createWithdrawInstructions(
  conn: Connection,
  programId: PublicKey,
  stakePoolAddress: PublicKey,
  poolAmount: BN,
  pool: schema.StakePool,
  poolTokenAccount: PublicKey, // if not provided, associated token account used
  owner: PublicKey
) {
  const [poolWithdrawAuthority, _] = await PublicKey.findProgramAddress(
    [stakePoolAddress.toBuffer(), Buffer.from(AUTHORITY_WITHDRAW)],
    programId
  );

  const poolStakeAccounts = await getParsedStakingAccount(conn, {
    stakeAuthority: null,
    withdrawAuthority: poolWithdrawAuthority
  });
  if (!poolStakeAccounts || poolStakeAccounts.length == 0) {
    throw Error('no pool stake account found');
  }

  const stakeAccountRentExemptLamports =
    await conn.getMinimumBalanceForRentExemption(STAKE_STATE_LEN);

  const withdrawFromList = prepareWithdrawAccounts(
    pool,
    poolAmount,
    stakeAccountRentExemptLamports,
    poolStakeAccounts
  );

  const newStakeKeypairs: Keypair[] = [];

  const transferAuthority = Keypair.generate();
  const ixs: TransactionInstruction[] = [
    TokenInstructions.approve({
      source: poolTokenAccount,
      delegate: transferAuthority.publicKey,
      owner: owner,
      amount: poolAmount
    })
  ];

  const stakeLamports = await conn.getMinimumBalanceForRentExemption(
    STAKE_STATE_LEN
  );
  for (const from of withdrawFromList) {
    const stakeReceiver = Keypair.generate();
    newStakeKeypairs.push(stakeReceiver);

    ixs.push(
      SystemProgram.createAccount({
        fromPubkey: owner, // fee payer
        newAccountPubkey: stakeReceiver.publicKey,
        lamports: stakeLamports,
        space: STAKE_STATE_LEN,
        programId: StakeProgram.programId
      })
    );

    const dataLayout = BufferLayout.struct([
      BufferLayout.u8('instruction'),
      uint64('amount')
    ]);

    // console.log('dataLayout.span', dataLayout.span);
    const data = Buffer.alloc(dataLayout.span);
    dataLayout.encode(
      {
        instruction: 11, // Withdraw
        amount: bnToU64Buffer(from.poolAmount)
      },
      data
    );

    ixs.push(
      new TransactionInstruction({
        keys: [
          { pubkey: stakePoolAddress, isWritable: true, isSigner: false },
          { pubkey: pool.validatorList, isWritable: true, isSigner: false },
          { pubkey: poolWithdrawAuthority, isWritable: false, isSigner: false },
          { pubkey: from.stakeAddress, isWritable: true, isSigner: false },
          {
            pubkey: stakeReceiver.publicKey,
            isWritable: true,
            isSigner: false
          },
          { pubkey: owner, isWritable: false, isSigner: false }, //userStakeAuthority
          {
            pubkey: transferAuthority.publicKey,
            isWritable: false,
            isSigner: true
          }, //transferAuthority
          { pubkey: poolTokenAccount, isWritable: true, isSigner: false },
          { pubkey: pool.managerFeeAccount, isWritable: true, isSigner: false },
          { pubkey: pool.poolMint, isWritable: true, isSigner: false },
          { pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false },
          { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
          { pubkey: StakeProgram.programId, isWritable: false, isSigner: false }
        ],
        data: data,
        programId: programId
      })
    );
  }

  return { ixs, newStakeKeypairs, userTransferAuthority: transferAuthority };
}

export async function createUpdateInstructions(
  conn: Connection,
  programId: PublicKey,
  stakePoolAddress: PublicKey,
  noMerge: boolean,
) {
  const epochInfo = await conn.getEpochInfo();
  const poolState: schema.StakePool = schema.StakePool.decodeUnchecked(
    ((await conn.getAccountInfo(stakePoolAddress)) as AccountInfo<Buffer>).data,
  );

  if (poolState.lastUpdateEpoch.eq(new BN(epochInfo.epoch))) {
    //no update needed
    return [[], []];
  }

  const validatorListState: schema.ValidatorList =
    schema.ValidatorList.decodeUnchecked(
      (
        (await conn.getAccountInfo(
          poolState.validatorList,
        )) as AccountInfo<Buffer>
      ).data,
    );

  const [stakePoolWithdrawAuthority, _] = await PublicKey.findProgramAddress(
    [stakePoolAddress.toBuffer(), Buffer.from(AUTHORITY_WITHDRAW)],
    programId,
  );

  const updateListInstructions: TransactionInstruction[] = [];
  const MAX_VALIDATORS_TO_UPDATE = 5; //see stake-pool/program/src/lib.rs#MAX_VALIDATORS_TO_UPDATE
  for (
    let vindex = 0;
    vindex < validatorListState.validators.length;
    vindex += MAX_VALIDATORS_TO_UPDATE
  ) {
    const chunk = validatorListState.validators.slice(
      vindex,
      vindex + MAX_VALIDATORS_TO_UPDATE,
    );
    const keys: AccountMeta[] = [
      {pubkey: stakePoolAddress, isWritable: false, isSigner: false},
      {
        pubkey: stakePoolWithdrawAuthority,
        isWritable: false,
        isSigner: false,
      },
      {pubkey: poolState.validatorList, isWritable: true, isSigner: false},
      {pubkey: poolState.reserveStake, isWritable: true, isSigner: false},
      {pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false},
      {
        pubkey: SYSVAR_STAKE_HISTORY_PUBKEY,
        isWritable: false,
        isSigner: false,
      },
      {pubkey: StakeProgram.programId, isWritable: false, isSigner: false},
    ];

    for (const v of chunk) {
      const [validatorStakeAccount, _nonce] = await findStakeProgramAddress(
        programId,
        v.voteAccountAddress,
        stakePoolAddress,
      );
      const [transientStakeAccount, _] = await findTransientStakeProgramAddress(
        programId,
        v.voteAccountAddress,
        stakePoolAddress,
      );
      keys.push(
        {pubkey: validatorStakeAccount, isWritable: true, isSigner: false},
        {pubkey: transientStakeAccount, isWritable: true, isSigner: false},
      );
    }

    const dataLayoutUpdateValidatorListBalance = BufferLayout.struct([
      BufferLayout.u8('instruction'),
      BufferLayout.u32('startIndex'),
      BufferLayout.u8('noMerge'), //true: 1, false: 0
    ]);
    const data = Buffer.alloc(dataLayoutUpdateValidatorListBalance.span);
    dataLayoutUpdateValidatorListBalance.encode(
      {
        instruction: 7, // UpdateValidatorListBalance
        startIndex: vindex,
        noMerge: noMerge ? 1 : 0,
      },
      data,
    );

    updateListInstructions.push(
      new TransactionInstruction({
        programId: programId,
        keys: keys,
        data,
      }),
    );
  } // for trunk done

  const finalInstructions = [
    await updateStakePoolBalanceInstruction(
      programId,
      stakePoolAddress,
      stakePoolWithdrawAuthority,
      poolState.validatorList,
      poolState.reserveStake,
      poolState.managerFeeAccount,
      poolState.poolMint,
    ),
    await cleanupRemovedValidatorEntries(
      programId,
      stakePoolAddress,
      poolState.validatorList,
    ),
  ];
  return [updateListInstructions, finalInstructions];
}

const TRANSIENT_STAKE_SEED = 'transient';
export async function findTransientStakeProgramAddress(
  stakePoolProgramId: PublicKey,
  voteAccountAddress: PublicKey,
  stakePoolAddress: PublicKey,
) {
  return await PublicKey.findProgramAddress(
    [
      Buffer.from(TRANSIENT_STAKE_SEED),
      voteAccountAddress.toBuffer(),
      stakePoolAddress.toBuffer(),
    ],
    stakePoolProgramId,
  );
}

export async function findStakeProgramAddress(
  stakePoolProgramId: PublicKey,
  voteAccountAddress: PublicKey,
  stakePoolAddress: PublicKey,
) {
  return await PublicKey.findProgramAddress(
    [voteAccountAddress.toBuffer(), stakePoolAddress.toBuffer()],
    stakePoolProgramId,
  );
}

export async function updateStakePoolBalanceInstruction(
  program_id: PublicKey,
  stake_pool: PublicKey,
  withdraw_authority: PublicKey,
  validator_list_storage: PublicKey,
  reserve_stake: PublicKey,
  manager_fee_account: PublicKey,
  stake_pool_mint: PublicKey,
) {
  const keys: AccountMeta[] = [
    {pubkey: stake_pool, isWritable: true, isSigner: false},
    {pubkey: withdraw_authority, isWritable: false, isSigner: false},
    {pubkey: validator_list_storage, isWritable: true, isSigner: false},
    {pubkey: reserve_stake, isWritable: false, isSigner: false},
    {pubkey: manager_fee_account, isWritable: true, isSigner: false},
    {pubkey: stake_pool_mint, isWritable: true, isSigner: false},
    {pubkey: SYSVAR_CLOCK_PUBKEY, isWritable: false, isSigner: false},
    {pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false},
  ];
  return new TransactionInstruction({
    programId: program_id,
    keys: keys,
    data: Buffer.of(8), //UpdateStakePoolBalance
  });
}

export async function cleanupRemovedValidatorEntries(
  programId: PublicKey,
  stakePool: PublicKey,
  validatorListStorage: PublicKey,
) {
  return new TransactionInstruction({
    keys: [
      {pubkey: stakePool, isWritable: false, isSigner: false},
      {pubkey: validatorListStorage, isWritable: true, isSigner: false},
    ],
    programId: programId,
    data: Buffer.of(9), //CleanupRemovedValidatorEntries
  });
}

// assume stakePool is the latest state (pool update finished)
export function calcLamportsWithdrawAmount(
  stakePool: schema.StakePool,
  poolTokens: BN,
): BN {
  const numerator = poolTokens.mul(stakePool.totalStakeLamports);
  const denominator = stakePool.poolTokenSupply;
  if (numerator.lt(denominator) || denominator.eq(new BN(0))) {
    return new BN(0);
  } else {
    return numerator.div(denominator);
  }
}

export function prepareWithdrawAccounts(
  pool: schema.StakePool,
  poolAmount: BN,
  stakeAccountRentExemptLamports: number,
  poolStakeAccounts: JsonParsedNativeStakeAccount[]
): {
  stakeAddress: PublicKey;
  poolAmount: BN;
}[] {
  // console.log('dbg, pool amount:', poolAmount.toString());
  // console.log('dbg RentExemptLamports', stakeAccountRentExemptLamports);

  const poolValidatorStakeMinBalance =
    stakeAccountRentExemptLamports + MIN_STAKE_BALANCE_LAMPORTS;

  const withdrawFrom: {
    stakeAddress: PublicKey;
    poolAmount: BN;
  }[] = [];
  let remainingAmount = poolAmount.clone();
  const reserveStakeAccount = pool.reserveStake.toBase58();
  const isReserveStakeAccount = (account: string) => {
    return account == reserveStakeAccount;
  };
  poolStakeAccounts = poolStakeAccounts.filter(
    psa =>
      (isReserveStakeAccount(psa.publicKey) &&
        psa.lamports > stakeAccountRentExemptLamports) ||
      psa.lamports > poolValidatorStakeMinBalance
  );

  poolStakeAccounts = poolStakeAccounts.sort((a, b) => {
    if (isReserveStakeAccount(a.publicKey)) {
      return 1;
    }
    if (isReserveStakeAccount(b.publicKey)) {
      return -1;
    }
    return b.lamports - a.lamports;
  }); //high available lamports first, reserve last

  for (const stakeAccount of poolStakeAccounts) {
    const shouldKeepLamports = isReserveStakeAccount(stakeAccount.publicKey)
      ? new BN(stakeAccountRentExemptLamports)
      : new BN(poolValidatorStakeMinBalance);
    let availableForWithdraw = calcLamportsWithdrawAmount(
      pool,
      new BN(stakeAccount.lamports).sub(shouldKeepLamports)
    );
    availableForWithdraw = BN.min(availableForWithdraw, remainingAmount);
    if (availableForWithdraw.isZero()) {
      continue;
    }
    withdrawFrom.push({
      stakeAddress: new PublicKey(stakeAccount.publicKey),
      poolAmount: availableForWithdraw
    });
    remainingAmount = remainingAmount.sub(availableForWithdraw);
    if (remainingAmount.isZero()) {
      break;
    }
  }
  if (remainingAmount.gt(new BN(0))) {
    throw Error(
      `No stake accounts found in this pool with enough balance to withdraw ${poolAmount.toString()} pool tokens`
    );
  }
  // for (const f of withdrawFrom) {
  //   console.log(`[dbg] from: ${f.stakeAddress} -> ${f.poolAmount.toString()}`);
  // }
  return withdrawFrom;
}