FROM 720146705806.dkr.ecr.us-east-1.amazonaws.com/debian-python3.7:bullseye
ARG DEBIAN_FRONTEND=noninteractive

# install latest 16.x node version
RUN apt-get update && apt-get install -y --allow-unauthenticated --fix-missing curl vim wget git gnupg procps udev dnsutils unzip sudo less net-tools iputils-ping htop ncdu
RUN curl -sL https://deb.nodesource.com/setup_16.x | bash -
RUN apt-get install -y --force-yes nodejs

RUN npm install -g forever
RUN  pip install awscli
COPY package.json /opt/workers/proximus/zombies-tracker/
RUN useradd -m -s /bin/bash -u 9020 proximuszt; passwd proximuszt -l;
RUN chown -R proximuszt:proximuszt /opt/workers/proximus/zombies-tracker;
USER proximuszt
WORKDIR /opt/workers/proximus/zombies-tracker
RUN rm -rf node_modules; npm install;
USER root
COPY --chown=proximuszt:proximuszt . /opt/workers/proximus/zombies-tracker/