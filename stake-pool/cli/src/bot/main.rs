#[macro_use]
extern crate lazy_static;

use solana_client::rpc_client::RpcClient;
use solana_program::{native_token, pubkey::Pubkey};
use solana_sdk::{commitment_config::CommitmentConfig, signer::Signer};
use spl_stake_pool::stake_program;
use stake_pool_cli::client::get_stake_pool;
use std::str::FromStr;

lazy_static! {
    static ref MIN_STAKE_BALANCE: u64 = native_token::sol_to_lamports(1.0);
}

/*
example:
{
  "solana_config_path": "/home/foo/.config/solana/cli/config.yml",
  "stake_pool_address": "some_pool_address",
  "rebalance_left_epoch": 200,
  "preferred_vote_account": "preferred_vote_account",
  "dry_run": false,
  "loop_second": 60,
  "disable_rebalance": false
}
*/
#[derive(serde::Serialize, serde::Deserialize, Debug)]
struct BotConf {
    pub solana_config_path: String, //private key, rpc, etc...
    pub stake_pool_address: String,
    pub rebalance_left_epoch: u64,
    pub preferred_vote_account: String,
    pub dry_run: bool,
    pub loop_second: u64,
    pub disable_rebalance: bool,
}

// build: cd stake-pool/cli && cargo build --bin stake-pool-bot --release
// suppose dir: stake-pool-bot conf.json
// run: STAKE_POOL_CONF=`pwd`/conf.json ./stake-pool-bot   (TODO, we need self contained guide)
// - conf.json, id.json(to replace), start.sh, bot-binary, mainnet.yml
// check: address

fn main() {
    let conf_path = std::env::var("STAKE_POOL_CONF").unwrap_or(String::from("./conf.json"));
    println!("conf_path: {}", conf_path);
    let reader =
        std::io::BufReader::new(std::fs::File::open(conf_path).expect("unable to read bot config"));
    let conf: BotConf =
        serde_json::from_reader(reader).expect("unable to parse bot config as json BotConf");
    println!("conf: {:?}", conf);

    let cli_config = if !conf.solana_config_path.is_empty() {
        solana_cli_config::Config::load(conf.solana_config_path.as_str()).unwrap_or_default()
    } else {
        solana_cli_config::Config::default()
    };
    println!("solana cli conf: {:?}", cli_config);
    let rpc_client =
        RpcClient::new_with_commitment(cli_config.json_rpc_url, CommitmentConfig::confirmed());

    let signer = solana_sdk::signer::keypair::read_keypair_file(cli_config.keypair_path)
        .expect("read keypair failed")
        .pubkey();
    println!("address for your keypair: {}", signer);
    let signer_account = rpc_client
        .get_account(&signer)
        .expect("get signer account failed");
    if signer_account.lamports < native_token::sol_to_lamports(0.001) {
        panic!("insufficient lamports, you need som SOL to support update fee, maybe 0.001SOL");
    }
    println!(
        "balance in SOL: {}",
        native_token::lamports_to_sol(signer_account.lamports)
    );

    let stake_pool_address =
        &Pubkey::from_str(conf.stake_pool_address.as_str()).expect("invalid stake pool address");
    let _ = rpc_client
        .get_account(stake_pool_address)
        .expect("unable to get pool account"); //check pool is configured correctly

    let vote_account = &Pubkey::from_str(conf.preferred_vote_account.as_str())
        .expect("invalid preferred vote account");

    println!("start loop");
    loop {
        std::thread::sleep(std::time::Duration::from_secs(conf.loop_second));
        stake_pool_cli::trigger_update_stake_pool(
            conf.solana_config_path.to_string(),
            stake_pool_address,
            false,
            false,
        );

        if conf.disable_rebalance {
            continue;
        }

        let ret = check_and_increase_validator_stake(
            conf.solana_config_path.to_string(),
            &rpc_client,
            conf.rebalance_left_epoch,
            stake_pool_address,
            vote_account,
            conf.dry_run,
        );
        match ret {
            Ok(_) => {}
            Err(err) => {
                println!("[ERR] rebalance err: {:?}", err);
            }
        }
    }
}

fn check_and_increase_validator_stake(
    solana_config_path: String,
    rpc_client: &RpcClient,
    left_epoch: u64,
    stake_pool_address: &Pubkey,
    vote_account: &Pubkey,
    dry_run: bool,
) -> Result<(), String> {
    // if less than #left_epoch, and reserve account has more than 1SOL, increase stake to validator
    let epoch_info = rpc_client
        .get_epoch_info()
        .map_err(|e| format!("get epoch err: {}", e.to_string()))?;
    let stake_pool = get_stake_pool(rpc_client, stake_pool_address)
        .map_err(|e| format!("get stake pool err: {}", e.to_string()))?;

    if epoch_info.slots_in_epoch - epoch_info.slot_index > left_epoch {
        return Ok(());
    }
    let reserve_stake = rpc_client
        .get_account(&stake_pool.reserve_stake)
        .map_err(|e| format!("get reserve stake account err: {}", e.to_string()))?;
    let minimum_reserve_stake_balance = rpc_client
        .get_minimum_balance_for_rent_exemption(std::mem::size_of::<stake_program::StakeState>())
        .map_err(|e| format!("ge rent exemption err: {}", e.to_string()))?;
    if reserve_stake.lamports <= 2 * minimum_reserve_stake_balance + *MIN_STAKE_BALANCE {
        return Ok(());
    }

    // TODO: check transient stake account, if exists log and skip

    let split_lamports =
        reserve_stake.lamports - (2 * minimum_reserve_stake_balance + *MIN_STAKE_BALANCE);

    stake_pool_cli::trigger_command_increase_validator_stake(
        solana_config_path,
        stake_pool_address,
        vote_account,
        native_token::lamports_to_sol(split_lamports),
        dry_run,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::BotConf;
    use std::str::FromStr;

    #[test]
    pub fn print_example_conf_json() {
        let conf = BotConf {
            solana_config_path: String::from("/home/foo/.config/solana/cli/config.yml"),
            stake_pool_address: String::from("some_pool_address"),
            rebalance_left_epoch: 200,
            preferred_vote_account: String::from("preferred_vote_account"),
            dry_run: false,
            loop_second: 60,
            disable_rebalance: false,
        };
        println!("{}", serde_json::to_string_pretty(&conf).unwrap());
    }

}