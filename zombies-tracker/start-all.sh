#!/bin/bash

# shellcheck disable=SC2236
if [ ! -z "${DEBUG}" ]
then
  set -x
  echo DEBUG is ON
fi

if [ -z "$ZOMBIES_TRACKER_LOG_DIR" ]
then
  export ZOMBIES_TRACKER_LOG_DIR=/prems_logs/app/zombies-tracker
  echo Setting ZOMBIES_TRACKER_LOG_DIR to default: $ZOMBIES_TRACKER_LOG_DIR
else
  echo Got ZOMBIES_TRACKER_LOG_DIR from ENV : $ZOMBIES_TRACKER_LOG_DIR
fi

mkdir -p $ZOMBIES_TRACKER_LOG_DIR
chown -R proximuszt:proximuszt $ZOMBIES_TRACKER_LOG_DIR

su proximuszt -c ./start-zombies-tracker.sh

sleep infinity
  
