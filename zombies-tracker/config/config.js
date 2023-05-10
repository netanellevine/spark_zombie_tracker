const SECOND = 1000;
const MINUTE = SECOND * 60;
const HOUR = MINUTE * 60;

module.exports = (function() {

   const dbConfig = {
      host: process.env.postgres?process.env.postgres:'localhost',
      user: 'remuser',
      password: '123456',
      database: 'REMDB',
      port: process.env.postgres_port?process.env.postgres_port:5432,
      statement_timeout: process.env.PG_TIMEOUT_MS?parseInt(process.env.PG_TIMEOUT_MS, 10): 1500000
   };


   const that = {
      dbConfig: dbConfig,
      timeForZombie: process.env.TIME_FOR_ZOMBIE_HOURS? parseInt(process.env.TIME_FOR_ZOMBIE_HOURS) * HOUR: 72 * HOUR,
      repeatInterval: process.env.CHECK_INTERVAL_HOURS? parseInt(process.env.CHECK_INTERVAL_HOURS) * HOUR: HOUR,
      clusterManager: process.env.CLUSTER_MANAGER? process.env.CLUSTER_MANAGER: 'localhost:5700',
      portListened: process.argv[2]? process.argv[2]:5800,
      awsTimeout: process.env.AWS_TIMEOUT ? parseInt(process.env.AWS_TIMEOUT, 10) : 120,
      s3Bucket: process.env.S3_BUCKET? process.env.S3_BUCKET: 'mobileye-code',
      skipKill: process.env.SKIP_KILLING_ZOMBIES? process.env.SKIP_KILLING_ZOMBIES: false,
   };

   return that;
})();


