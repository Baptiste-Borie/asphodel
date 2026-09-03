#!/usr/bin/env sh
set -eu

MAVEN_VERSION="3.9.11"
MAVEN_SHA512="bcfe4fe305c962ace56ac7b5fc7a08b87d5abd8b7e89027ab251069faebee516b0ded8961445d6d91ec1985dfe30f8153268843c89aa392733d1a3ec956c9978"
SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIRECTORY=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/.." && pwd)
MAVEN_DIRECTORY="$PROJECT_DIRECTORY/.cache/apache-maven-$MAVEN_VERSION"
ARCHIVE="$PROJECT_DIRECTORY/.cache/apache-maven-$MAVEN_VERSION-bin.tar.gz"

if [ ! -x "$MAVEN_DIRECTORY/bin/mvn" ]; then
  mkdir -p "$PROJECT_DIRECTORY/.cache"
  TEMPORARY_ARCHIVE=$(mktemp "$PROJECT_DIRECTORY/.cache/maven-download.XXXXXX")
  trap 'rm -f "$TEMPORARY_ARCHIVE"' EXIT HUP INT TERM

  curl --fail-with-body --location --silent --show-error \
    "https://archive.apache.org/dist/maven/maven-3/$MAVEN_VERSION/binaries/apache-maven-$MAVEN_VERSION-bin.tar.gz" \
    --output "$TEMPORARY_ARCHIVE"

  ACTUAL_SHA512=$(sha512sum "$TEMPORARY_ARCHIVE" | cut -d ' ' -f 1)
  if [ "$ACTUAL_SHA512" != "$MAVEN_SHA512" ]; then
    echo "Apache Maven checksum mismatch" >&2
    exit 1
  fi

  rm -rf "$MAVEN_DIRECTORY"
  tar -xzf "$TEMPORARY_ARCHIVE" -C "$PROJECT_DIRECTORY/.cache"
  mv "$TEMPORARY_ARCHIVE" "$ARCHIVE"
  trap - EXIT HUP INT TERM
fi

exec "$MAVEN_DIRECTORY/bin/mvn" "$@"
