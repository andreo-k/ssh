import * as yargs from 'yargs';
import * as _ from 'lodash';
import SSH2Promise = require('ssh2-promise');
import {InputOutputFilter} from "./input-output-filter";
import {GetCommandInterceptor} from "./get-command";



async function main() {
    try {

        let arg = _.get(yargs.argv, '_[0]');

        if (_.isEmpty(arg)) {
            console.error(`Missing argument. Example: node ssh user:password@host[:port]`);
            process.exit(1);
        }

        let argParsed = arg.match(/([^:]+):([^@]+)@([^:]+)(:(\d+))?/i);

        if (!argParsed) {
            console.error(`Wrong argument. Example: node ssh user:password@host[:port]`);
            process.exit(1);
        }

        var sshconfig = {
            host: argParsed[3],
            port: argParsed[5],
            username: argParsed[1],
            password: argParsed[2]
        }

        var ssh = new SSH2Promise(sshconfig);

        await ssh.connect();

        console.log('connection established');

        let chan = await ssh.shell();

        chan.stderr.pipe(process.stderr);

        let filter = new InputOutputFilter([new GetCommandInterceptor()]);
        filter.filterInput(process.stdin).pipe(chan.stdin);
        filter.filterOutput(chan.stdout).pipe(process.stdout);
    }
    catch (e) {
        console.error(e);
        process.exit(1);
    }
}

main();