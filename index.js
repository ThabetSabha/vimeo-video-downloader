const { Vimeo } = require("vimeo");
let {
    clientId,
    clientSecret,
    accessToken,
    startPage,
    endPage,
    lastAllowedDate,
    whereToDownload,
} = require("./config.json");
const fs = require("fs");
const fetch = require("node-fetch");
const failedVideos = {};
const failedPages = {};
let numFailed = 0;
let numSuccess = 0;
let pageFetchedLast = 0;

/**
 * Makes sure the needed config is provided.
 */
const validateConfig = () => {
    startPage = startPage || 1;
    endPage = endPage || Infinity;
    lastAllowedDate = new Date(lastAllowedDate) || Date.now();
    whereToDownload = whereToDownload || __dirname;
    if (clientId && clientSecret && accessToken) return;
    console.log(`Please provide a valid clientId, clientSecret, accessToken, and userId in the config.json file`);
    process.exit(1);
};

/**
 * Given a file name and a download link, will attempt to fetch the file from the link and save it to
 * the file name, will also update the failed videos if the download fails.
 * @param {string} name Name of the file
 * @param {string} url The url to download the video from.
 * @param {string} videoId The id of the video.
 * @returns true if successfull, false otherwise.
 */
const downloadVideo = async (name, url, videoId, size) => {
    let path = whereToDownload + "/" + name;
    console.log(`Will start downloading file: ${videoId} which has a size of ${size} in ${path}`);
    const response = await fetch(url);
    return await new Promise((resolve) => {
        try {
            const readStream = response.body;
            const writeStream = fs.createWriteStream(path);
            readStream.pipe(writeStream);
            readStream.on("end", () => {
                console.log(`Done downloading file ${videoId} in ${path}`);
                numSuccess++;
                resolve(true);
            });
            readStream.on("error", (err) => {
                console.error(`\n\nError while downloading file: ${path}, error is: ${err}\n\n`);
                writeStream.close();
                numFailed++;
                failedVideos[videoId] = { err, url };
                readStream.destroy();
                resolve(false);
            });
        } catch (e) {
            console.error(`\n\nError while downloading file: ${path}, error is: ${e}\n\n`);
            failedVideos[videoId] = e;
            numFailed++;
            return resolve(false);
        }
    });
};

/**
 * Given a vimeo client and a page number, will fetch the videos in that page, and attempt to download them.
 * @param {Vimeo} client the vimeo client to fetch the data from.
 * @param {string | number} currentPage the page we want to fetch the data for.
 * @returns true if there is a next page, false if this is the last valid page.
 */
const getPageVideos = async (client, currentPage) => {
    let videosUrl = `https://api.vimeo.com/me/videos?direction=asc&sort=date&page=${currentPage}&per_page=100`;
    console.log(
        `\n\n==========================================\nWill begin fetching videos from page ${currentPage} using url ${videosUrl}\n==========================================\n\n`
    );
    return new Promise((resolve, reject) => {
        client.request(videosUrl, async (err, res) => {
            if (err) {
                console.log(`Error while trying to fetch the video files, ${err}`);
                return reject(err);
            }
            let nextPage = res.paging.next;
            let { data } = res;
            for (let video of data) {
                let { name, release_time: time, uri: videoId, download } = video;
                if (new Date(time) > lastAllowedDate) {
                    console.log(
                        `Will stop at video ${videoId}, since it has been released on ${time} which is after ${lastAllowedDate}`
                    );
                    return resolve(false);
                }
                if (!download || !download.length) {
                    failedVideos[videoId] = "Couldn't find a download link for the video";
                    continue;
                }
                let highestQuality = download.sort((a, b) => b.size - a.size)[0];
                let { type, rendition, link, size_short } = highestQuality;
                let extension = type.split("/")[1];
                let fileName = `${name}.${extension}`;
                console.log("\n");
                await downloadVideo(fileName, link, videoId, size_short);
            }

            return resolve(nextPage);
        });
    });
};

/**
 * Saves the results to ./results
 * @param {string | number} pageFetchedLast last page we fetched the data for.
 */
const finalize = (pageFetchedLast) => {
    console.log(
        `\n\n==========================================\nWill exit application, got to page ${pageFetchedLast}, number of successfully downloaded videos: ${numSuccess}, number of failed videos: ${numFailed}\n==========================================\n\n`
    );
    let currTime = Date.now().toString();
    let resultsPath = `./results/${currTime}`;
    fs.mkdirSync(resultsPath, { recursive: true });
    fs.writeFileSync(
        `${resultsPath}/overall.json`,
        JSON.stringify({ startPage, pageFetchedLast, numSuccess, numFailed })
    );
    fs.writeFileSync(`${resultsPath}/FailedVideos.json`, JSON.stringify(failedVideos));
};

/**
 * Given a start page and a vimeo client, fetches all the pages from the start page, until there is no next valid page.
 * @param {Vimeo} client The Vimeo client
 * @param {number | string} startPage page to start fetching from.
 */
const getAllPages = async (client, startPage) => {
    let currentPage = startPage;
    let canContinue = true;
    while (canContinue && endPage >= currentPage) {
        try {
            canContinue = await getPageVideos(client, currentPage);
        } catch (e) {
            console.error(`Error fetching page: ${currentPage}, ${e} will skip`);
            failedPages[currentPage] = e;
        }
        pageFetchedLast = currentPage;
        currentPage++;
    }
};
/**
 * Will start the application by calling the main functions in order.
 */
const initialize = async () => {
    try {
        validateConfig();
        console.log(`Will start downloading videos released before ${lastAllowedDate}`);
        let client = new Vimeo(clientId, clientSecret, accessToken);
        await getAllPages(client, startPage);
        finalize(pageFetchedLast);
    } catch (e) {
        console.error(`Error in the application: ${e}`);
        finalize(pageFetchedLast);
    }
};

process.on("SIGINT", () => {
    console.log("TERMINATING, will try to finalize");
    finalize();
    process.exit(1);
});

process.on("uncaughtException", (err) => {
    console.error(`Unchaught Error: ${err}, will finalize`);
    finalize();
    process.exit(1);
});

process.on("unhandledRejection", (err) => {
    console.error(`Unhandled Reject: ${err}, will finalize`);
    finalize();
    process.exit(1);
});

initialize();
