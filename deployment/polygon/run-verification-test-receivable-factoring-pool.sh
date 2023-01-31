#!/bin/bash

pwd
source .env
rm -rf hardhat_node.temp
npx hardhat node --fork $POLYGON_URL > hardhat_node.temp &
pid=$!
echo "hardhat node pid: $pid"

for ((i=0; i<30; i++)); do
    sleep 1
    echo "check hardhat node started [$i]"
    found=`grep "Account #19" hardhat_node.temp`
    if [ "$found" != "" ]
    then
        break
    fi
done

if ((i<30));
then
    echo "hardhat node started successfully."
    yarn hardhat run deployment/polygon/verification-test-receivable-factoring-pool.js --network localhost
    res=$?
else
    echo "hardhat node failed to start."    
fi

printf "\n"
echo "close hardhat node..."
kill $pid

if ((res==0));
then
    echo "delete temp file..."
    rm -rf hardhat_node.temp
    echo "All verficiation tests passed."
    printf "\n"
else
    echo "Verification tests failed."   
fi