#!/bin/sh
docker run -v $HOME/production-s3-backup/:/bu graphistry/s3cmd-postgres s3cmd --access_key=`cat aws/s3/vizapp/access` --secret_key=`cat aws/s3/vizapp/secret` --skip-existing sync s3://graphistry.data/ /bu/