export UID=$(id -u)
export GID=$(id -g)
node ./k8s/generators/generator.js
./docker/$HOST_TYPE/docker-compose-build.sh
mkdir -p ./tmp
rm -rf ./tmp/$PROJECT_NAME-bot-$HOST_TYPE.tar.gz
docker save $PROJECT_NAME/bot:local | gzip > ./tmp/$PROJECT_NAME-bot-$HOST_TYPE.tar.gz