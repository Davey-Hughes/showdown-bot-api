var dex = require('./Pokemon-Showdown-Server/sim/dex');

if (process.argv.length < 3) {
    console.log('error');
}

packedteam = dex.packTeam(JSON.parse(process.argv[2]));
console.log(packedteam);
