import * as Q from "q";
import {Interceptor} from './input-output-filter';
const fs = require('fs');

export class GetCommandInterceptor extends Interceptor {

    private buf = '';

    private active = false;

    constructor() {
        super();
    }

    public get isActive() {
        return this.active;
    }


    private async executeCommandInternal(filename: string) {
        //obtain file size
        await this.emitRemoteInput(`ls -l ${filename} | awk '{print $5;}'`);
        let line = await this.expectRemoteOutput();
        let siz = Number.parseInt(line);
        if (Number.isNaN(siz)) {
            await this.emitOutput("Can not find the file");
            return;
        }

        //obtain file content
        await this.emitRemoteInput(`base64 ${filename}`);

        var wstream = fs.createWriteStream('output.dat');


        while (siz > 0) {
            line = await this.expectRemoteOutput();
            line = line.replace(/\n|\r/g, '');
            let buf = Buffer.from(line, 'base64');
            siz-= buf.length;
            console.log(`siz is ${siz}`);
            await Q.nbind(wstream.write, wstream)(buf);
        }


        await wstream.close();

        let iii = 123;
        //this.active = false;
    }

    private async executeCommand(filename: string) {
        try {
            await this.executeCommandInternal(filename);
        } catch(e) {
            console.error(e);
        }
        this.active = false;
    }

    async work() {

        while (true) {
            let line = await this.expectInput();

            let command = line.match(/get (.*)/);
            if (command) {

                this.active = true;
                await this.executeCommand(command[1]);
            }
            this.buf = '';
        }
    }

}
