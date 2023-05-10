job "proximus-zombies-tracker" {
  datacenters = ["dc1"]
  type = "service"

  constraint {
    attribute = "${node.class}"
    value     = "com.proximus"
  }

  constraint {
    operator  = "distinct_hosts"
    value     = "true"
  }

  group "proximus-zombies-tracker" {
    count = 1
    restart {
      attempts = 10
      interval = "5m"
      delay = "25s"
      mode = "delay"
    }

    task "proximus-zombies-tracker" {
      driver = "raw_exec"
      kill_timeout = "120s"
      config {
         command = "/opt/nomad_docker_run.sh"
         args = ["--network=host",
                 "-e postgres=${PREMS_ENV_LIVY_DB_HOST}",
                 "-e ZOMBIES_TRACKER_LOG_DIR=/prems_logs/app/zombies-tracker",
                 "-e AWS_DEFAULT_REGION=${PREMS_ENV_AWS_DEFAULT_REGION}",
                 "-e AWS_REGION=${PREMS_ENV_REGION}",
                 "-e AWS_TIMEOUT=120",
                 "-e TIME_FOR_ZOMBIE_HOURS=72",
                 "-e CHECK_INTERVAL_HOURS=1",
                 "-e S3_BUCKET=${PREMS_ENV_S3_CODE_BUCKET}",
                 "-e SKIP_KILLING_ZOMBIES=false",
                 "-e CLUSTER_MANAGER=proximus-api.service.consul:5700",
                 "-v /prems_logs/app/:/prems_logs/app/",
                 "${PREMS_ENV_AWS_ACCOUNT}.dkr.ecr.${PREMS_ENV_AWS_DEFAULT_REGION}.${PREMS_ENV_AWSDOMAIN}/proximus-zombies-tracker:v4.3",
                 "/opt/workers/proximus/zombies-tracker/start-all.sh"]
      }

    }
  }
}
