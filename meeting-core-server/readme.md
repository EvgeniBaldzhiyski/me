## Skeleton for sygnaling server 

### Development
Run the server in dev mode. It will watch for code changes

```bash
npm run start
```

### Run server
If you just want to run the server and don't need to watch for changes:

```
npm run build # first we need to build the server
npm run start # then start it
```

### Start in a docker container

In the `sock-server` folder we have a Dockerfile and a shell script for running the docker container.

```
# to rebuild the image
./docker.sh rebuild

# to start the container
./docker.sh start

# to start the container in dev mode
./docker.sh start_dev

# to open a terminal for the container
./docker.sh terminal

# to stop the container
./docker.sh stop
```

***Note:*** *If there is an error when executing the commands - check the line endings for docker.sh is LF!*

### Running tests

```bash
npm test
```

### Linting

```bash
npm run lint
```
### If you got error 

npm ERR! Cannot read property '0' of undefined
    Delete 
        package-lock.json, node_modules
    Execute
        npm install  
       
