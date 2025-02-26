#!/bin/bash

echo "Verify gh version"
gh --version

# release_tag="1.43.0"; # $(echo "$release_tag" | sed 's/^v//')
release_tag=$(gh api "repos/eclipse-jdtls/eclipse.jdt.ls/tags" --jq '.[0].name' | sed 's/^v//')

target_url="https://download.eclipse.org/jdtls/milestones/$release_tag"
curl -L -o release.txt "$target_url/latest.txt"
echo "Targeting $release_tag from eclipse-jdtls/eclipse.jdt.ls"

artifact_name=$(cat release.txt)
echo "Downloading $artifact_name from $target_url"
curl -L -o server.tar.gz "$target_url/$artifact_name"

echo "Downloading lombok"
curl -L -o lombok.jar https://projectlombok.org/downloads/lombok.jar

echo "Extracting server resource artifacts"
rm -rf ./server && mkdir -p server
tar -xvzf server.tar.gz -C ./server
mv lombok.jar ./server/lombok.jar
rm -rf server.tar.gz
rm -rf release.txt
