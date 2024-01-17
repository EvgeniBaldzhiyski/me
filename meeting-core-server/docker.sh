#!/bin/bash

##### Functions

CONTAINER_NAME="meetingcore"
IMAGE_NAME="meetingcore/socket"

# removes the container and rebuilds the image
rebuild()
{
    if [ ! -f ./dist/socket-server/src/index.js ]; then
        echo "Before rebuilding you need to build the socket server."
        echo "npm build"
        exit 1
    fi

    # first we need to stop the container
    docker stop $CONTAINER_NAME
    # then remove it
    docker rm $CONTAINER_NAME
    # and rebuild the image
    docker build -t $IMAGE_NAME .
}

# starts the container in dev mode - it watches for changes in app.js file, when changed the node server is restarted
start_dev()
{
    # first we need to stop the container
    docker stop $CONTAINER_NAME
    # then remove it
    docker rm $CONTAINER_NAME
    
    # we run the container with an additional volume and we overwrite the default command
    # the nodemonDocker script is starting nodemon -L - the L parameter switches on legacyWatch for nodemon, it is needed when executed in a docker container
    docker run -d --name $CONTAINER_NAME -v "$(pwd)"/dist:/usr/src/app/dist/ -e NODE_CONFIG_DIR='./config' -p 5050:5050 $IMAGE_NAME npm run-script nodemonDocker
}

# stops the container
stop()
{
    # first we need to stop the container
    docker stop $CONTAINER_NAME
    # then remove it
    docker rm $CONTAINER_NAME
}

# starts the container in prod mode - no nodemon to watch for nodejs file changes, still if the client code in public is changed it will serve the last version
start()
{
    # first we need to stop the container
    docker stop $CONTAINER_NAME
    # then remove it
    docker rm $CONTAINER_NAME
    
    # we run the container
    docker run -d --name $CONTAINER_NAME -e NODE_CONFIG_DIR='./config' -p 5050:5050 $IMAGE_NAME
}

# opens a terminal to the container
terminal()
{
    # we use sh, because we do not have bash in alpine
    docker exec -ti $CONTAINER_NAME sh
}

case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    terminal)
        terminal
        ;;
    start_dev)
        start_dev
        ;;
    rebuild)
        rebuild
        ;;
    *)
        echo $"Usage: $0 {rebuild|start|stop|start_dev}"
        exit 1
esac
