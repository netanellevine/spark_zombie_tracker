#!/bin/bash

# shellcheck disable=SC2236
if [ ! -z "${DEBUG}" ]
then
  set -x
  echo DEBUG is ON
fi

# shellcheck disable=SC2006
# shellcheck disable=SC2164
cd /opt/workers/proximus/zombies-tracker

if [ -z "$NODE_ENV" ]
then
  echo NODE_ENV not set. Setting to development.
  NODE_ENV=development
fi

if [ -z "$WORKER_PROCESSES_NUMBER" ]
then
  # shellcheck disable=SC2006
  WORKER_PROCESSES_NUMBER=1
fi

echo Launching "$WORKER_PROCESSES_NUMBER" workers

# shellcheck disable=SC2006
for i in `seq 1 "${WORKER_PROCESSES_NUMBER}"`;
do
   # shellcheck disable=SC2004
   port=$(( ${WORKER_PORT} + $i ))
   forever start -a -l "$ZOMBIES_TRACKER_LOG_DIR"/worker_"$i".log --spinSleepTime 5000 --minUptime 1000 src/tracker.js $port
done
