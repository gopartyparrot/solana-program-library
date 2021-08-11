import {
  createAssociatedTokenAccount,
  getAssociatedTokenAddress,
} from '@project-serum/associated-token';

import {toByteArray} from 'base64-js';
import {
  AccountInfo,
  Connection,
  Keypair,
  PublicKey,
  SOLANA_SCHEMA,
  StakeProgram,
  Transaction,
} from '@solana/web3.js';
import * as index from './index.js';
import {
  createDepositSOLInstructionsWithConnection,
  createDepositStakeInstructionsWithConnection,
  createUpdateInstructions,
  createWithdrawInstructionsWithConnection,
  findStakeProgramAddress,
} from './instruction.js';
import * as schema from './schema.js';
import util from 'util';
import BN from 'bn.js';
import {sleep} from '@project-serum/common';
import {StakePool} from './schema.js';

PublicKey.prototype['toJSON'] = function () {
  return this.toBase58();
};

PublicKey.prototype[util.inspect.custom] = function () {
  return this.toBase58();
};

// replace: wallet -> connection -> pool address
// add validator:  watch epoch -> create/add
// deposit: check id.json => create json id/ create stake account/ delegate => config modify => wait2epoch => deposit
// withdraw: beginOfEpoch => update + withdraw

/**

//pool, vote account
./spl-stake-pool create-validator-stake HMgnMVm3UnC75T9aDy2hMhRJiLKGPhc6ecj8Nq9t9icX Hn8Y1v6mZ3bfMPXFieobKD7VgXkk1wWjEYCsEQxNJXvH

// pool, vote account
./spl-stake-pool add-validator HMgnMVm3UnC75T9aDy2hMhRJiLKGPhc6ecj8Nq9t9icX Hn8Y1v6mZ3bfMPXFieobKD7VgXkk1wWjEYCsEQxNJXvH

solana stake-account 3J2WnfWRGx9xabu8T9hQqbDP2Ro6wqPL7xtgktXkRPHx
solana-keygen new -o split-stake.json --force
//stake account address
solana split-stake 3J2WnfWRGx9xabu8T9hQqbDP2Ro6wqPL7xtgktXkRPHx split-stake.json 0.000008717

-> update validator stake account in pool

// before merge:
./spl-stake-pool update HMgnMVm3UnC75T9aDy2hMhRJiLKGPhc6ecj8Nq9t9icX
 * 
 */
const POOL_PROGRAM = new PublicKey(
  'SPoo1xuN9wGpxNjGnPNbRPtpQ7mHgKM8d9BeFC549Jy',
);
const POOL_ADDRESS = new PublicKey(
  'HMgnMVm3UnC75T9aDy2hMhRJiLKGPhc6ecj8Nq9t9icX',
);

const wallet = Keypair.fromSecretKey(
  Uint8Array.of(
    ...[
      //TODO
    ],
  ),
);

const connection = new Connection('http://localhost:8899/', 'confirmed');
// const connection = new Connection('http://45.63.122.49:8080/', 'confirmed');

export async function getState(conn: Connection, poolAddress: PublicKey) {
  const pool: StakePool = StakePool.decodeUnchecked(
    ((await conn.getAccountInfo(poolAddress)) as AccountInfo<Buffer>).data,
  );
  const validators: schema.ValidatorList = schema.ValidatorList.decodeUnchecked(
    ((await conn.getAccountInfo(pool.validatorList)) as AccountInfo<Buffer>)
      .data,
  );
  return {
    pool,
    validatorList: validators,
  };
}

async function listValidatorsInPool() {
  const validators = await index.getStakePoolAccounts(connection, POOL_PROGRAM);
  validators.map(account => {
    index.prettyPrintAccount(account);
    console.log('\n');
  });
}

/**
solana-keygen new --no-passphrase -o stake-account.json --force
solana create-stake-account stake-account.json 10
solana delegate-stake $ Hn8Y1v6mZ3bfMPXFieobKD7VgXkk1wWjEYCsEQxNJXvH
 
solana delegate-stake <stake-account> <vote-account>
 */
async function depositStake() {
  const {pool, validatorList} = await getState(connection, POOL_ADDRESS);

  //user accounts
  const stakeAccount = new PublicKey(
    '6P7LqNmNGaqiBGf94ZLNMrcMWHqXAfHG7RW7aWRmMc9L',
  ); //will got from RPC: getProgramAccount + filter

  //first try to update stake pool
  const [updateListInstructions, updateFinalInstructions] =
    await createUpdateInstructions(
      connection,
      POOL_PROGRAM,
      POOL_ADDRESS,
      false,
    );
  for (const ix of updateListInstructions) {
    //we just need wait last instruction
    // console.log('update xxx:', JSON.stringify(ix, null, '  '));
    const txid = await connection.sendTransaction(new Transaction().add(ix), [
      wallet,
    ]);
    console.log('update txid:', txid);
  }
  if (updateFinalInstructions && updateFinalInstructions.length > 0) {
    await sleep(1000); // we need last transaction executed
    // console.log('will send final instruction: ', JSON.stringify(updateFinalInstructions, null, '  '));
    const updateFinalTxid = await connection.sendTransaction(
      new Transaction().add(...updateFinalInstructions),
      [wallet],
    );
    console.log('update final txid:', updateFinalTxid);
  }

  const associatedPSOLAccount = await getAssociatedTokenAddress(
    wallet.publicKey,
    new PublicKey(pool.poolMint),
  );

  const [validatorStakeAccount, _nonce] = await findStakeProgramAddress(
    POOL_PROGRAM,
    validatorList.validators[0].voteAccountAddress,
    POOL_ADDRESS,
  );

  await sleep(1000); // we need last transaction executed
  let ixs = await createDepositStakeInstructionsWithConnection(
    connection,
    POOL_PROGRAM,
    POOL_ADDRESS,
    stakeAccount,
    validatorList.validators[0].voteAccountAddress, //userStakeAccount.stakeAccount
    wallet.publicKey,
    associatedPSOLAccount,
    associatedPSOLAccount,
  );

  // Note: if user associated token account not exists, should add create instruction

  // ixs = [
  //   await createAssociatedTokenAccount(
  //     wallet.publicKey,
  //     wallet.publicKey,
  //     pool.poolMint,
  //   ),
  //   ...ixs,
  // ];

  // const simu = await connection.simulateTransaction(new Transaction().add(...ixs), [wallet]);
  // console.log('simulate result: ', simu);

  const txid = await connection.sendTransaction(new Transaction().add(...ixs), [
    wallet,
  ]);
  console.log('txid:', txid);
}

export async function depositSOL() {
  //first try to update stake pool
  await doUpdate();

  const {pool, validatorList} = await getState(connection, POOL_ADDRESS);
  const associatedPSOLAccount = await getAssociatedTokenAddress(
    wallet.publicKey,
    pool.poolMint,
  );
  const {ixs, signers} = await createDepositSOLInstructionsWithConnection(
    connection,
    POOL_PROGRAM,
    POOL_ADDRESS,
    new BN(1000000000),
    wallet.publicKey,
    associatedPSOLAccount,
    associatedPSOLAccount,
  );

  // console.log('ixs:', JSON.stringify(ixs, null, '  '));

  const txid = await connection.sendTransaction(new Transaction().add(...ixs), [
    wallet,
    ...signers,
  ]);
  console.log('deposit SOL txid:', txid);
}

async function doUpdate() {
  const [updateListInstructions, updateFinalInstructions] =
    await createUpdateInstructions(
      connection,
      POOL_PROGRAM,
      POOL_ADDRESS,
      false,
    );
  for (const ix of updateListInstructions) {
    //we just need wait last instruction
    // console.log('update xxx:', JSON.stringify(ix, null, '  '));
    const txid = await connection.sendTransaction(new Transaction().add(ix), [
      wallet,
    ]);
    console.log('update txid:', txid);
  }
  if (updateFinalInstructions && updateFinalInstructions.length > 0) {
    await sleep(1000); // we need last transaction executed
    // console.log('will send final instruction: ', JSON.stringify(updateFinalInstructions, null, '  '));
    const updateFinalTxid = await connection.sendTransaction(
      new Transaction().add(...updateFinalInstructions),
      [wallet],
    );
    console.log('update final txid:', updateFinalTxid);
  }

  await sleep(1000);
}

async function withdraw() {
  const {pool, validatorList} = await getState(connection, POOL_ADDRESS);

  //first try to update stake pool
  await doUpdate();

  const associatedPSOLAccount = await getAssociatedTokenAddress(
    wallet.publicKey,
    pool.poolMint,
  );
  const [validatorStakeAccount, _nonce] = await findStakeProgramAddress(
    POOL_PROGRAM,
    validatorList.validators[0].voteAccountAddress,
    POOL_ADDRESS,
  );
  let {ixs, newStakeKeypairs, userTransferAuthority} =
    await createWithdrawInstructionsWithConnection(
      connection,
      POOL_PROGRAM,
      POOL_ADDRESS,
      new BN(1000000000), //decimals: 9
      wallet.publicKey,
      associatedPSOLAccount,
    );

  // console.log('instructions: ', JSON.stringify(ixs, null, '  '));
  // const simu = await connection.simulateTransaction(
  //   new Transaction().add(...ixs),
  //   [wallet],
  // );
  // console.log('simulate result: ', simu);

  // console.log('ixs:', JSON.stringify(ixs, null, '  '));
  const txid = await connection.sendTransaction(new Transaction().add(...ixs), [
    wallet,
    ...newStakeKeypairs,
    userTransferAuthority,
  ]);
  console.log('txid:', txid);
}

// offset: 124,
// bytes: filter.voteTo.toBase58(),

// offset: 12,
// bytes: filter.stakeAuthority.toBase58(),

// offset: 44,
// bytes: filter.withdrawAuthority.toBase58(),

async function decodeValidatorList() {
  // const acc = await connection.getAccountInfo(config.);
  // const data = schema.ValidatorList.decodeUnchecked(acc.data);
  // console.log('validator list: ', JSON.stringify(data, null, '  '));
}

async function splitStakeAccount() {
  const nativeStakeAccountToSplit = new PublicKey(
    'Aiu8ayneFs7a8DnSaeRd1oTBxrwKGAzC5KYCEGHP367z',
  );
  const newStakeAccount = Keypair.generate();
  console.log('new split stake account', newStakeAccount.publicKey.toBase58());

  const tx = StakeProgram.split({
    stakePubkey: nativeStakeAccountToSplit,
    authorizedPubkey: wallet.publicKey,
    splitStakePubkey: newStakeAccount.publicKey,
    lamports: 1000000000, //1sol
  });
  const txid = await connection.sendTransaction(tx, [wallet, newStakeAccount]);
  console.log('split txid:', txid);
}

schema.addStakePoolSchema(SOLANA_SCHEMA);

(function () {
  //stake pool

  // stake pool from rust unit test
  // const b64 = "AQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACgAAAAAAAAADAAAAAAAAAAABCQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABCgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKAAAAAAAAAAMAAAAAAAAACgAAAAAAAAADAAAAAAAAAAAAAQsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACgAAAAAAAAADAAAAAAAAAAA=";

  // const keyU8arr = Uint8Array.of(
  //   1, 0, 0, 0, 0, 0, 0, 0,
  //   0, 0, 0, 0, 0, 0, 0, 0,
  //   0, 0, 0, 0, 0, 0, 0, 0,
  //   0, 0, 0, 0, 0, 0, 0, 0,);
  // const keyU8arr = Uint8Array.of(198, 159, 164,  23, 203,  29, 187,  39,  85,  93, 175,
  //   234, 206, 181, 207, 252, 191, 165, 182, 207, 170,  13,  76,
  //   173, 121, 141, 177, 131,  67, 112, 226, 245);
  // const k = PublicKey.decodeUnchecked(Buffer.from(keyU8arr));
  // console.log('create public key(wanted):', new PublicKey(keyU8arr).toBase58());
  // console.log('decode publickey(actual):', k.toBase58());

  // local cluster
  const b64 =
    'AcafpBfLHbsnVV2v6s61z/y/pbbPqg1MrXmNsYNDcOL1xp+kF8sduydVXa/qzrXP/L+lts+qDUyteY2xg0Nw4vUfJlnBq2Ea1qLYFQl4+O//zNxtspOnJTzVKJJhrIzQ0//P+xJBwxTI9Tj2PWRNXiBv+FwJXvzc2O5ZJ8jbMEYYjOEdToVevClgYV67JllR2IJK1x26ROGippKXuIPjvDhm3Bg1mUOtvspTOu30Zi2bLCDcIA8ziUy3JkdRW3lwMCXyz21eQCXfXwgkZUMGJhqEBBNUVNkNWGXEVHq9z5WpWgbd9uHXZaGT2cvhRs7reawctIXtX1s3kTqM9YV+/wCpAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAZAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADoAwAAAAAAAAUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
  const b = toByteArray(b64);
  console.log('b len', b.length);
  console.log('account: buffer:', b);
  const pool: schema.StakePool = schema.StakePool.decodeUnchecked(
    Buffer.from(b),
  );
  console.log('type of pool manager:', typeof pool.manager, pool.manager);
  // console.log('pool.manager.toBytes: ', pool.manager.toBytes().reverse());
  // console.log('manager public key(wanted):', new PublicKey(pool.manager.toBytes().reverse()).toBase58());
  console.log('pool: ', JSON.stringify(pool, null, '  '));

  //validator list
  // const e2 =
  //   'AgoAAAACAAAAAgAAAAAAAAACAAAAAAAAAAIAAAAAAAAAAAkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAACAAAAAAAAAAIAAAAAAAAAAAoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  // const b2 = toByteArray(e2);
  // const validatorList = schema.ValidatorList.decodeUnchecked(Buffer.from(b2));
  // console.log('validator list:', JSON.stringify(validatorList, null, '  '));
});

// listValidatorsInPool();

// depositStake();
// decodeValidatorList();
withdraw();
// depositSOL();
// splitStakeAccount();
