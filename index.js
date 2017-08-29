var express = require('express');
var webtorrent = require('webtorrent');
var path = require('path');
var http = require('http');
var app = express();
var fs = require('fs');
var serveIndex = require('serve-index');

var port = process.env.PORT || 9111;

var client = new webtorrent();

// Allow Cross-Origin requests
app.use(function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'OPTIONS, POST, GET, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

app.use(express.static(path.join(__dirname, 'app')));

app.use('/downloads', serveIndex('app', {
    'icons': true
}))
app.use('/downloads', express.static(path.join(__dirname, 'app')));

var getLargestFile = function(torrent) {
    var file;
    for (i = 0; i < torrent.files.length; i++) {
        if (!file || file.length < torrent.files[i].length) {
            file = torrent.files[i];
        }
    }
    return file;
};

var rmDir = function(dirPath, removeSelf) {
    if (removeSelf === undefined)
        removeSelf = true;
    try {
        var files = fs.readdirSync(dirPath);
    } catch (e) {
        return;
    }
    if (files.length > 0)
        for (var i = 0; i < files.length; i++) {
            var filePath = path.join(dirPath, files[i]);
            if (fs.statSync(filePath).isFile())
                fs.unlinkSync(filePath);
            else
                rmDir(filePath);
        }
    if (removeSelf)
        fs.rmdirSync(dirPath);
};

var buildMagnetURI = function(infoHash) {
    return 'magnet:?xt=urn:btih:' + infoHash + '&tr=udp%3A%2F%2Ftracker.publicbt.com%3A80&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80&tr=udp%3A%2F%2Ftracker.ccc.de%3A80&tr=udp%3A%2F%2Ftracker.istole.it%3A80&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Fexodus.desync.com%3A6969';
};

app.get('/api/add/:infoHash', function(req, res) {
    if (typeof req.params.infoHash == 'undefined' || req.params.infoHash == '') {
        res.status(500).send('Missing infoHash parameter!');
        return;
    }
    var torrent = buildMagnetURI(req.params.infoHash);
    try {
        client.add(torrent, function(torrent) {
            var file = getLargestFile(torrent);
            torrent.swarm.on('upload', function() {
                if (torrent.length == torrent.downloaded) {
                    torrent.swarm.destroy();
                    torrent.discovery.stop();
                }
            });
            res.status(200).send('Added torrent!');
        });
    } catch (err) {
        res.status(500).send('Error: ' + err.toString());
    }
});

app.get('/api/addTorrent/:infoHash', function(req, res) {
    if (typeof req.params.infoHash == 'undefined' || req.params.infoHash == '') {
        res.status(500).send('Missing infoHash parameter!');
        return;
    }
    var torrent = buildMagnetURI(req.params.infoHash);
    var downloadPath = './app/torrents/';
    if (!(typeof req.params.downloadPath == 'undefined' || req.params.downloadPath == '')) {
        downloadPath = downloadPath + req.params.downloadPath;
    } else {
        downloadPath = downloadPath + req.params.infoHash;
    }
    try {
        client.add(torrent, {
            path: downloadPath
        }, function(torrent) {
            res.status(200).send('Added torrent!');
        });
    } catch (err) {
        res.status(500).send('Error: ' + err.toString());
    }
});

app.get('/api/deleteFile/*', function(req, res) {
    if (typeof req.params[0] == 'undefined' || req.params[0] == '') {
        res.status(500).send('Missing directory parameter!');
        return;
    }

    if (req.params[0].indexOf('..') != -1) {
        res.status(500).send('Cannot use .. in directory parameter!');
        return;
    }

    var deletePath = './app/torrents/';
    deletePath = path.join(deletePath, req.params[0]);

    try {

        var torrent1 = buildMagnetURI(req.params[0]);
        var torrent = client.remove(torrent1);
        rmDir(deletePath);
        res.status(200).send('Deleted directory: ' + deletePath);
    } catch (err) {
        res.status(500).send('Error: ' + err.toString());
    }
});

app.get('/api/getTorrentDetails/:infoHash', function(req, res) {
    if (typeof req.params.infoHash == 'undefined' || req.params.infoHash == '') {
        res.status(500).send('Missing infoHash parameter!');
        return;
    }
    var torrent = buildMagnetURI(req.params.infoHash);
    try {
        var torrent = client.get(torrent);
        res.status(200).send('Progress: ' + torrent.progress + 'Time Remain: ' + torrent.timeRemaining);
    } catch (err) {
        res.status(500).send('Error: ' + err.toString());
    }
});

app.get('/stream/:infoHash.mp4', function(req, res, next) {
    if (typeof req.params.infoHash == 'undefined' || req.params.infoHash == '') {
        res.status(500).send('Missing infoHash parameter!');
        return;
    }
    var torrent = buildMagnetURI(req.params.infoHash);
    try {
        var torrent = client.get(torrent);
        var file = getLargestFile(torrent);
        var total = file.length;

        if (typeof req.headers.range != 'undefined') {
            var range = req.headers.range;
            var parts = range.replace(/bytes=/, "").split("-");
            var partialstart = parts[0];
            var partialend = parts[1];
            var start = parseInt(partialstart, 10);
            var end = partialend ? parseInt(partialend, 10) : total - 1;
            var chunksize = (end - start) + 1;
        } else {
            var start = 0;
            var end = total;
        }

        var stream = file.createReadStream({
            start: start,
            end: end
        });
        res.writeHead(206, {
            'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'video/mp4'
        });
        stream.pipe(res);
    } catch (err) {
        res.status(500).send('Error: ' + err.toString());
    }
});


app.get('/api/delete/:infoHash', function(req, res, next) {
    if (typeof req.params.infoHash == 'undefined' || req.params.infoHash == '') {
        res.status(500).send('Missing infoHash parameter!');
        return;
    }
    var torrent = buildMagnetURI(req.params.infoHash);
    try {
        var torrent = client.remove(torrent);
        res.status(200).send('Removed torrent. ');
    } catch (err) {
        res.status(500).send('Error: ' + err.toString());
    }
});

var server = http.createServer(app);
server.listen(port, function() {
    console.log('Listening on http://127.0.0.1:' + port);
});