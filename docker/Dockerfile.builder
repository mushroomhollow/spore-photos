# syntax=docker/dockerfile:1
#
# The Android APK builder — deliberately NOT part of the app image.
#
# The runtime image stays Node-only; this one carries a JDK and the Android SDK
# (~2.5 GB) and exists so that building an APK needs nothing installed on the
# host. It is behind a compose profile, so a normal `docker compose up` never
# pulls it:
#
#   cd docker
#   docker compose --profile build run --rm builder build
#   docker compose --profile build run --rm builder --check
#
# It is not published anywhere. Every operator builds (and signs) their own.

# Node from the official image: Debian's nodejs is too old for the client build
# (Vite 8 needs 20.19+), and this project builds the web assets as part of an
# APK. Two stages, because node:22 and a JDK base image cannot simply be merged.
FROM node:22-bookworm-slim AS node

FROM eclipse-temurin:21-jdk AS builder

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      curl unzip git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ─── Android SDK ──────────────────────────────────────────────────────────────
# Versions are arguments so an operator can bump them without editing the file.
ARG CMDLINE_TOOLS_BUILD=11076708
ARG ANDROID_PLATFORM=android-35
ARG ANDROID_BUILD_TOOLS=35.0.0

ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    JAVA_HOME=/opt/java/openjdk

RUN mkdir -p "$ANDROID_HOME/cmdline-tools" \
 && curl -fsSL -o /tmp/cmdline-tools.zip \
      "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_BUILD}_latest.zip" \
 && unzip -q /tmp/cmdline-tools.zip -d "$ANDROID_HOME/cmdline-tools" \
 && mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest" \
 && rm /tmp/cmdline-tools.zip

# Licence acceptance is unavoidable and is done here, once, at image build time.
RUN yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null \
 && "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" \
      "platform-tools" "platforms;${ANDROID_PLATFORM}" "build-tools;${ANDROID_BUILD_TOOLS}" > /dev/null

ENV PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}"

# The repository is bind-mounted here at run time (see compose.yaml), so the
# script, the keystore and the output directory are the host's own — an APK
# built here lands exactly where the server serves it from.
WORKDIR /repo

ENTRYPOINT ["bash", "spore-photos-mobile/scripts/build-apk.sh"]
CMD ["--check"]
