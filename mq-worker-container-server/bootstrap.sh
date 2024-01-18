#!/bin/bash

childProcessPidFile=/tmp/PROCESS_PID

prep_term()
{
    echo 'PREPARING TERM'
    unset term_child_pid
    unset term_kill_needed
    rm $childProcessPidFile 2>/dev/null
    trap 'handle_term' TERM INT
}

handle_term()
{
    echo 'SIGTERM/INT detected'
    if [ "${term_child_pid}" ]; then
        echo "TERMINATING child ${term_child_pid}"
        kill -s TERM "${term_child_pid}" 2>/dev/null
        while [ -e /proc/$term_child_pid ]; do
            sleep 1  # slow the loop so we don't use up all the dots.
        done
        echo "TERMINATING parent ${term_parent_pid}"
        kill -s TERM "${term_parent_pid}" 2>/dev/null
    else
        echo 'SIGTERM/INT initiated before process start'
        exit 0
    fi
}

wait_term()
{
    term_parent_pid=$1
    wait ${term_parent_pid} 2>/dev/null
    trap - TERM INT
    wait ${term_parent_pid} 2>/dev/null
}

prep_term

rm -rf ~/.config/base-box/* 2>/dev/null
rm -rf ~/.cache/base-box/* 2>/dev/null
rm /tmp/.X99-lock 2>/dev/null

if  [ "$1" = "--debug" ]; then
  socat tcp-listen:9239,fork tcp:localhost:9222 &
fi

export NW_PRE_ARGS=--window-size=${DISPLAY_WIDTH},${DISPLAY_HEIGHT}

Xvfb :99 -screen 0 ${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}x${DISPLAY_BITS} -nolisten tcp 2>/dev/null &

echo 'RUNNING NW'
if  [ "$1" = "--debug" ]; then
  /opt/nwjs/nw ./ --remote-debugging-port=9222 &
else
  /opt/nwjs/nw ./ &
fi
term_parent_pid=$!
echo "NW Parent PID ${term_parent_pid}"

count=0
while [ ! -e $childProcessPidFile ]; do
  sleep 1  # waiting for the child pid to be known
  count=$(($count + 1))
  if [ $count -gt 60 ]; then
    echo 'Child process PID is not available after 60 seconds, exiting...'
    exit 1
  fi
done

term_child_pid=$(cat $childProcessPidFile)
echo "NW Child PID ${term_child_pid}"

wait_term $term_parent_pid
