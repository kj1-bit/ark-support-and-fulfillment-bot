'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
function sha256(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function backupDatabase({databasePath,backupDirectory,clock=Date.now}){if(!fs.existsSync(databasePath))throw new Error('Database file does not exist.');fs.mkdirSync(backupDirectory,{recursive:true});const target=path.join(backupDirectory,`database-${clock()}.sqlite-backup`);fs.copyFileSync(databasePath,target,fs.constants.COPYFILE_EXCL);return Object.freeze({path:target,sha256:sha256(target),bytes:fs.statSync(target).size});}
function restoreDatabase({
  backupPath,
  databasePath,
  expectedSha256
}) {
  if (sha256(backupPath) !== expectedSha256) {
    throw new Error('Backup checksum mismatch.');
  }

  const temp = `${databasePath}.restore-${process.pid}`;
  const previous = `${databasePath}.previous-${process.pid}`;

  fs.copyFileSync(backupPath, temp);

  try {
    if (fs.existsSync(databasePath)) {
      fs.renameSync(databasePath, previous);
    }

    fs.renameSync(temp, databasePath);

    if (fs.existsSync(previous)) {
      fs.unlinkSync(previous);
    }
  } catch (error) {
    if (
      fs.existsSync(previous) &&
      !fs.existsSync(databasePath)
    ) {
      fs.renameSync(previous, databasePath);
    }

    throw error;
  } finally {
    if (fs.existsSync(temp)) {
      fs.unlinkSync(temp);
    }
  }

  return Object.freeze({
    path: databasePath,
    sha256: sha256(databasePath),
    bytes: fs.statSync(databasePath).size
  });
}
async function checkIntegrity(database){const row=await database.get('PRAGMA quick_check');const value=Object.values(row||{})[0];if(value!=='ok')throw new Error('Database integrity check failed.');return true;}
module.exports={backupDatabase,checkIntegrity,restoreDatabase,sha256};
