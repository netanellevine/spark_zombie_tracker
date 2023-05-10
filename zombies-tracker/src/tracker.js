const config = require('../config/config.js');
const axios = require('axios');
const {exec} = require('child_process');
const underscore = require('underscore');
const async = require('async');
const { promisify } = require('util');
const { performance } = require('perf_hooks');
require('console-stamp')(console, {pattern: 'dd/mm/yyyy HH:MM:ss.l'});

// params for s3
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const AWS_TIMEOUT = config.awsTimeout;
const S3_KEY = 'proximus/zombies-tracker';
const S3_BUCKET = config.s3Bucket;


const SERVICE_NAME = 'zombies-tracker';

// The definition of zombie is an app that was not updated for more than X time.
const ZOMBIES_THRESHOLD = config.timeForZombie;


// Time to wait between each run
const WAITING_TIME = config.repeatInterval;

let NUMBER_OF_ZOMBIES_FOUND = 0;
let NUMBER_OF_ZOMBIES_KILLED = 0;

// In case we want to skip the killing of the zombies
const SKIP_KILL = config.skipKill === 'true';


// old
// const dateRegex = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;
// new
const dateRegex = /\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?|\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}|\d{4}-\d{2}-\d{2} \d{2}:\d{2}|\d{4}-\d{2}-\d{2}/;
// any of the following: YYYY-MM-DDTHH:mm:ss                  YYYY-MM-DD HH:mm:ss                   YYYY-MM-DDTHH:mm             YYYY-MM-DD HH:mm               YYYY-MM-DD


// for pretty print
const makeWay = function() {
    console.log("");
    console.log("");
}


/**
 * Workflow:
 * 1. get all clusters.
 * 2. for each cluster get all running drivers.
 * 3. go over each cluster and for each cluster get all running drivers.
 * 4. for each driver get the driver's data - apps  (id, state, logs).
 * 5. check if the latest log(update) of this app is more than X time.
 * 6. add to log file the app id and the cluster name.
 * 7. upload the log file to s3
 * 8. kill the zombies
 **/


// 1. get all clusters.
const getClusters = async function() {
    makeWay();
    console.log('>>>> getClusters :: starting');
    try {
        const URL = `http://${config.clusterManager}/clusters`;
        const response = await axios.get(URL);
        console.log(`>>>> getClusters :: got clusters: ${JSON.stringify(response.data)}`);
        console.log('>>>> getClusters :: finished');
        return response.data;
    } catch (error) {
        let msg = `>>>> getClusters :: unable to get clusters - error: ${error} response: ${JSON.stringify(error.response.data)}`;
        console.error(msg);
        console.log('>>>> getClusters :: finished with error!');
        throw new Error(msg);
    }
};



//2. for each cluster get all running drivers.
const getDrivers = async function(clusters) {
    makeWay();
    console.log(">>>> getDrivers :: starting");
    if (clusters.length === 0) {
        console.log(">>>> getDrivers :: finished with error!");
        throw new Error("getDrivers :: No clusters are defined in cluster manager");
    }

    console.log(`>>>> getDrivers :: there are ${clusters.length} clusters to check`);

    let clustersNames = underscore.map(clusters, (cluster) => cluster.cluster_vpc).join(",");
    console.log(`>>>> getDrivers :: querying clusters: ${clustersNames}`);

    try {
        // 3. go over each cluster and for each cluster get all running drivers.
        const existingDrivers = await getRunningDrivers(clustersNames);
        let filteredList = existingDrivers.filter(
            (value) => value !== undefined && value !== null && value !== ""
        );
        console.log(`>>>> getDrivers :: finished -> found ${filteredList.length} drivers`);
        return filteredList;
    } catch (error) {
        console.log(`>>>> getDrivers :: error: ${error}`);
        console.log(">>>> getDrivers :: finished with error!");
        throw new Error(`>>>> getDrivers :: error: ${error}`);
    }
};



// 3. for each cluster get all running drivers.
const getRunningDrivers = async function(clustersName) {
    makeWay();
    console.log(`>>>> getRunningDrivers :: starting for clusters: ${clustersName}`);

    // this command will return a list of objects with the following format: {cluster: <cluster_name>, ip: <ip_address>}
    const command = `aws ec2 describe-instances --filters "Name=tag:Name,Values=driversfarm-asg" ` +
    `"Name=instance-state-name,Values=running,pending" "Name=tag:Cluster,Values=${clustersName}" ` +
    `--query "Reservations[*].Instances[*].{ip: PrivateIpAddress, cluster: Tags[?Key==\'Cluster\'].Value | [0]}" --cli-read-timeout ${AWS_TIMEOUT} --cli-connect-timeout ${AWS_TIMEOUT}` +
    ` --output text | grep -oE "\\S+\\s+\\S+$" | awk '{print "{\\"cluster\\":\\""$1"\\",\\"ip\\":\\""$2"\\"}"}'`;

    try {
        const startTime = performance.now();
        const result = await promisify(exec)(command, { maxBuffer: 1024 * 1024 });
        const endTime = performance.now();
        console.log(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
        console.log(`>>>> [${SERVICE_NAME}] aws ec2 describe-instances took: ${endTime - startTime} ms`);
        console.log(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);

        console.log(`>>>> getRunningDrivers :: stdout: ${JSON.stringify(result)}`);
        let output = JSON.stringify(result);
        if (output === undefined || output === null || output === "" || result === undefined || result === null || result === "") {
            throw new Error(`>>>> getRunningDrivers :: error: no running drivers found`);
        }

        let runningDrivers = result.stdout.split('\n');
        // clean empty lines that might be in the output
        // go over each driver and parse it to json
        runningDrivers = runningDrivers.reduce((acc, driver) => {
            if (driver !== undefined && driver !== null && driver !== "") {
                acc.push(JSON.parse(driver));
            }
            return acc;
        }, []);
        console.log(`>>>> getRunningDrivers :: finished -> found ${runningDrivers.length} drivers`);
        return runningDrivers;

    } catch (error) {
        console.error(`>>>> getRunningDrivers :: error: ${error}`);
        console.log('>>>> getRunningDrivers :: finished with error!');
        throw new Error(`>>>> getRunningDrivers :: error: ${error}`);
    }
};



// 4. for each driver get the driver's data - apps  (id, state, logs).
// 5. check if the latest log(update) of this app is more than X time.
// 6. add to log file the app id and the cluster name.
const findZombies = async function(data) {
    makeWay();
    let runningDrivers = data;
    console.log('>>>> findZombies :: starting');
    console.log(`>>>> findZombies :: data: ${JSON.stringify(data)}`);
    let zombies = [];

    try {
        // run in parallel getDriverData for each driver and wait for all to finish, max runs in parallel is 20.
        // 4. for each driver get the driver's data - apps  (id, state, logs).
        const data = await async.mapLimit(runningDrivers, 20, getDriverData);

        // 5. check if the latest log(update) of this app is more than X time.
        for (const d of data) {
            if (d === undefined || d === null) {
            continue;
            }
            for (const instance of d) {
                if (instance === undefined || instance === null) {
                    continue;
                }
                // check if this instance is a zombie or not
                let res = isZombie(instance);
                console.log(`>>>> findZombies :: isZombie returned: ${res[0]} for id: ${instance.id}`);
                // if it is a zombie add it to the zombies array
                if (res[0]) {
                    zombies.push(res[1]);
                    NUMBER_OF_ZOMBIES_FOUND++;
                }
            }
        }

        console.log(`>>>> findZombies :: found ${zombies.length} zombies`);
        console.log(`>>>> findZombies :: zombies: ${JSON.stringify(zombies)}`);
        console.log('>>>> findZombies :: finished');
        return zombies;

    } catch (error) {
        console.log(`>>>> findZombies :: error: ${error}`);
        console.log('>>>> findZombies :: finished with error!');
        throw new Error(`>>>> findZombies :: error: ${error}`);
    }
};



// 4. for each driver get the driver's data - running apps  (id, state, logs).
const getDriverData = async function(driver) {
    makeWay();
    console.log(`>>>> getDriverData :: starting for driver: ${driver.ip}, cluster: ${driver.cluster}`);

    let ip = driver.ip;
    let cluster = driver.cluster;

    const url = `http://${ip}:8998/batches`

    try {
        // get the driver's data
        const response = await axios.get(url);
        const body = response.data;

        // console.log(`>>>> getDriverData :: got data :: ${JSON.stringify(body)}`);
        let ids = [];
        // take only the running sessions
        const runningSessions = body.sessions.filter((session) => session.state === 'running').map((session) => {
            ids.push(session.id);
            // return only the relevant data
            return {
                cluster: cluster,
                driver: ip,
                id: session.id,
                state: session.state,
                log: session.log
            };
        });
        console.log(`>>>> getDriverData :: found ${ids.length} running sessions, ids: ${ids.join(', ')}`);
        console.log(`>>>> getDriverData :: finished for driver: ${ip}, cluster: ${cluster}`);
        return runningSessions;

    } catch (error) {
        console.error(`>>>> getDriverData :: error: ${JSON.stringify(error)}`);
        console.log('>>>> getDriverData :: finished with error!');
        throw error;
    }
};



// 5. check if the latest log(update) of this app is more than X time.
const isZombie = function(data) {
    makeWay();
    console.log(`>>>> isZombie :: starting for id: ${data.id}`);
    const new_data = findLatestDate(data);
    if (new_data) {
        console.log(`>>>> isZombie :: got from findLatestDate: ${JSON.stringify(new_data)}`);
        const now = new Date();
        const diff = now - new_data["latest_update"];

        if (diff > ZOMBIES_THRESHOLD) {
            console.log(`>>>> isZombie :: found zombie! id: ${JSON.stringify(new_data["id"])}, latest update: ${JSON.stringify(new_data["latest_update"])}`);
            console.log(`>>>> isZombie :: finished for id: ${data.id}`)
            return [true, new_data];
        }
        console.log(`>>>> isZombie :: finished for id: ${data.id}`)
        return [false, new_data];
    }
    console.log(`>>>> isZombie :: no latest update found for id: ${data.id}`);
    console.log(`>>>> isZombie :: finished for id: ${data.id}`)
    return [false, undefined];
};



// in the log of the app find the latest date of update.
const findLatestDate = function(data) {
    makeWay();
    // console.log(`>>>> findLatestDate :: started for data: ${JSON.stringify(data)}`);
    console.log(`>>>> findLatestDate :: starting for id: ${data.id}`);
    const logEntries = data.log;
    let latestDate = null;
    let line = null;

    for (const entry of logEntries) {
        const match = dateRegex.exec(entry);
        if (match !== null) {
            const date = new Date(match[0]);
        if (latestDate === null || date > latestDate) {
            latestDate = date;
            line = entry;
            }
        }
    }

    if (latestDate !== null) {
        console.log(`>>>> findLatestDate :: The latest log entry of id: ${data.id} was written on: ${latestDate}`);
        console.log(`>>>> findLatestDate :: finished for id: ${data.id}`);
        return {
            cluster: data.cluster,
            driver: data.driver,
            id: data.id,
            state: data.state,
            latest_update: latestDate,
            latest_log_entry: line,
            log_entry: data.log
        };
    } else {
        console.log('>>>> findLatestDate :: No log entries found');
        console.log(`>>>> findLatestDate :: finished for id: ${data.id}`);
        return null;
    }
};



// 7. upload the zombies to s3.
const uploadToS3 = async function(zombies) {
    makeWay();
    console.log(`>>>> uploadToS3 :: starting`);

    const now = new Date();
    const fileName = `zombies_at_time_${now.getHours()}-${now.getMinutes()}-${now.getSeconds()}.json`;
    const today_dir = `date__${now.getDate()}_${now.getMonth() + 1}_${now.getFullYear()}`;
    console.log(`>>>> uploadToS3 :: fileName: ${fileName}`);
    console.log(`>>>> uploadToS3 :: uploading ${zombies.length} zombies to S3 bucket: ${S3_BUCKET} key: ${S3_KEY}/${today_dir}/${fileName}`);

    const params = {
        Bucket: S3_BUCKET,
        Key: `${S3_KEY}/${today_dir}/${fileName}`,
        Body: JSON.stringify(zombies, null, 4),
        ContentType: 'application/json'
    };

    try {
        const data = await s3.upload(params).promise();
        console.log(`>>>> uploadToS3 :: JSON object uploaded successfully to S3:\n ${JSON.stringify(data, null, 4)}`);
        console.log(`>>>> uploadToS3 :: finished`);

        return zombies;
    } catch (error) {
        console.error(`>>>> uploadToS3 :: error: ${error}`);
        console.log(`>>>> uploadToS3 :: finished`);
        throw new Error(`uploadToS3 :: error: ${error}`);
    }
};



// 8. kill the zombies
const killZombies = async function(zombies) {
    makeWay();
    console.log(`>>>> killZombies :: starting`);

    // if there are no zombies, we want to skip the next step (killZombie)
    if (zombies && zombies.length === 0) {
        console.log(">>>> killZombies :: skipping, no zombies found!");
        console.log(`>>>> killZombies :: finished`);
        return;
    }

    // if SKIP_KILL is true, we want to skip the next step (killZombie)
    if (SKIP_KILL) {
        console.log(">>>> killZombies :: skipping, SKIP_KILL is true!");
        console.log(`>>>> killZombies :: finished`);
        return;
    }

    try {
        // go over all the zombies and kill them
        const results = await Promise.all(zombies.map(zombie => killZombie(zombie)));
        console.log(`>>>> killZombies :: results: ${JSON.stringify(results)}`);
        console.log(`>>>> killZombies :: killed ${NUMBER_OF_ZOMBIES_KILLED} zombies`);
        console.log(`>>>> killZombies :: finished`);
    } catch (error) {
        console.error(`>>>> killZombies :: error: ${error}`);
        console.log(`>>>> killZombies :: finished`);
        throw new Error(`killZombies :: error: ${error}`);
    }
};



const killZombie = async function(zombie) {
    makeWay();
    if (zombie === undefined || zombie === null) {
        console.log(`>>>> killZombie :: no zombie to kill!`);
        return undefined;
    }
    console.log(`>>>> killZombie :: starting :: cluster: ${zombie.cluster}, driver: ${zombie.driver}, id: ${zombie.id}`);

    try {
        const url = `http://${zombie.driver}:8998/batches/${zombie.id}`;
        console.log(`>>>> killZombie :: url: ${url}`);
        const response = await axios.delete(url);
        console.log(`>>>> killZombie :: response 1: ${JSON.stringify(response.data)} for id: ${zombie.id} in cluster: ${zombie.cluster}`);

        if (JSON.stringify(response.data) === '{"msg":"deleted"}') {
            NUMBER_OF_ZOMBIES_KILLED++;
        }

        // we return the details about the zombie and the relevant response from the server.
        const result = {
            cluster: zombie.cluster,
            driver: zombie.driver,
            id: zombie.id,
            response: JSON.stringify(response.data),
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            config: response.config
        };

        console.log(`>>>> killZombie :: result`, JSON.stringify(result, null, 4));
        console.log(`>>>> killZombie :: finished`);
        return result;
    } catch (error) {
        console.error(`>>>> killZombie :: error: ${error}`);
        throw new Error(`killZombie :: error: ${error}`);
    }
};



// combining all the functions together.
/**
 * startTracking function
 * This function is the entry point for the tracking process.
 * It calls all the other functions in the right order (waterfall).
 * Each function is responsible for calling the next function in the chain.
 * Each function is also responsible for handling errors and passing them to the callback.
 * In addition, each function is responsible for calling the callback when it finishes and passing the results to it.
 * If an error occurs, the callback is called with an error the waterfall is stopped.
 */
const startTracking = async function() {
    console.log(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
    console.log('>>>> startTracking :: starting');
    console.log(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);

    try {
        const clusters = await getClusters();
        const drivers = await getDrivers(clusters);
        const zombies = await findZombies(drivers);
        await uploadToS3(zombies);
        // This function would be called only if zombies were found and SKIP_KILL is false.
        await killZombies(zombies);

        console.log(`>>>> startTracking :: total number of zombies found: ${NUMBER_OF_ZOMBIES_FOUND}`);
        console.log(`>>>> startTracking :: total number of zombies killed: ${NUMBER_OF_ZOMBIES_KILLED}`);

        // If zombies were found, check if all of them were killed.
        if (NUMBER_OF_ZOMBIES_FOUND !== 0) {
            let diff = NUMBER_OF_ZOMBIES_FOUND - NUMBER_OF_ZOMBIES_KILLED;
            console.log(`>>>> startTracking :: ${
                NUMBER_OF_ZOMBIES_FOUND === NUMBER_OF_ZOMBIES_KILLED ?
                'All zombies killed successfully' :
                `${diff} zombies were not killed`}`);
        }
        console.log(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
        console.log(`>>>> startTracking :: tracking finished successfully`);
        console.log(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
    } catch (error) {
        console.log(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
        console.error(`>>>> startTracking :: tracking finished with error: ${error}`);
        console.log(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
    }

    // start the tracking process again after WAITING_TIME milliseconds.
    setTimeout(startTracking, WAITING_TIME);
};



// activating the tracking process, because I cant use await in the top level.
(async () => {
    try {
        await startTracking();
    } catch (error) {
        console.error('Error occurred while starting tracking:', error);
    }
})();



module.exports = {
    markProximusZombies: startTracking
};
