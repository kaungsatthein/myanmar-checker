const fs = require('fs');

const b64 = fs.readFileSync('.tmp-socket-bundle.js').toString('base64');
const cmd = "node -e d='/tmp/myanmar-socket',f=require('fs'),p=require('child_process'),f.mkdirSync(d,{recursive:true}),f.existsSync(d+'/package.json')||p.spawnSync('npm',['init','-y'],{cwd:d,stdio:'ignore'}),p.spawnSync('npm',['i','socket.io@4.8.1'],{cwd:d,stdio:'ignore'}),f.writeFileSync(d+'/server.js',Buffer.from('" + b64 + "','base64')),require(d+'/server.js')";

const payload = {
  serviceDetails: {
    envSpecificDetails: {
      dockerCommand: cmd
    }
  }
};

fs.writeFileSync('.render-patch.json', JSON.stringify(payload));
console.log('payload-bytes', fs.statSync('.render-patch.json').size);
