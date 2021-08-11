export POOL=brLWa1RSHgRPbhv599yJrso9beczoehnFzi1dDGais8
export VOTE=CmchidQQdvrXfzaj6Qa7U7LPUFD1xgecDHLg6rXVaHAx

curl http://localhost:8899 -X POST -H "Content-Type: application/json" -d '
  {"jsonrpc":"2.0","id":1, "method":"getEpochInfo"}
'|json_pp

./spl-stake-pool create-validator-stake $POOL $VOTE

./spl-stake-pool add-validator $POOL $VOTE


./spl-stake-pool deposit-sol $POOL 100

./spl-stake-pool increase-validator-stake $POOL $VOTE 50

./spl-stake-pool update $POOL


# can withdraw?

./spl-stake-pool withdraw-stake $POOL 2

./spl-stake-pool list -v $POOL

