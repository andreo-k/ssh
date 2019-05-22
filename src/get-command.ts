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
        this.promRemoteOut.read();//abandon past output
        //obtain file size
        await this.emitRemoteInput(`ls -l ${filename} | awk '{print $5;}'`);
        let line = await this.expectRemoteOutputNotEmpty();
        let siz = Number.parseInt(line);
        if (Number.isNaN(siz)) {
            await this.emitOutput("Can not find the file");
            return;
        }

        //obtain file content
        await this.emitRemoteInput(`base64 ${filename}`);

        var wstream = fs.createWriteStream('output.dat');

        let last: any = [];

        while (siz > 0) {
            let chunk = await this.promRemoteOut.read(1);
            if (chunk[0]==10 || chunk[0]==13) {
                let base64line = Buffer.from(last).toString("utf-8");
                let buf = Buffer.from(base64line, 'base64');
                last = [];
                siz-= buf.length;
                await Q.nbind(wstream.write, wstream)(buf);
                console.log(`Remaining ${siz} bytes`);
            } else {
                last.push(chunk[0]);
            }
        }


        await wstream.close();
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
