import { window, workspace } from 'coc.nvim'
import compressing from 'compressing'
import got from 'got'
import tunnel from 'tunnel'
import parse from 'node-html-parser'

async function findLatestLangServerURL() : Promise<string> {
  let response = await got("https://download.eclipse.org/jdtls/milestones/");
  let root = parse(response.body);

  let aTags = root.getElementsByTagName("a"); // get all of the links
  aTags = aTags.filter(item => {
    if(item == undefined || item == null) {
      return false;
    }

    if(item.toString().includes("jdtls/milestones")) {
      return true;
    }

    return false;
  });
  aTags = aTags.sort();

  if(aTags.length == 0) {
    console.error("failed to find the latest version of the jdtls!");

    return null;
  }
  let latestTag = aTags[aTags.length - 1]; // the link to the page that hosts the latest version 
                                           // is the last in the markup

  let parentDirUrl = "https://download.eclipse.org" + latestTag.getAttribute("href");


  response = await got(parentDirUrl); // parse the page that hosts the ls to find the download link
  root = parse(response.body);

  aTags = root.getElementsByTagName("a");
  aTags = aTags.filter(item => {
    if(item == undefined || item == null) {
      return false;
    }

    if(item.toString().includes(".tar.gz") && !item.toString().includes(".sha256")) {
      return true;
    }

    return false;
  });

  if(aTags.length == 0) {
    console.error("failed to find jdtls url!");

    return null
  } else if(aTags.length > 1) {
    console.error("More than one url was found for the download. This is a programmer error.");

    return null;
  }

  let url = "https://download.eclipse.org" + aTags[0].getAttribute("href");
  return url;
}

export async function downloadServer(root: string): Promise<void> {
  let statusItem = window.createStatusBarItem(0, { progress: true })
  statusItem.text = 'Downloading jdt.ls from eclipse.org'
  statusItem.show()
  let config = workspace.getConfiguration('http')
  let proxy = config.get<string>('proxy', '')
  let options: any = { encoding: null }
  if (proxy) {
    let parts = proxy.replace(/^https?:\/\//, '').split(':', 2)
    options.agent = tunnel.httpOverHttp({
      proxy: {
        headers: {},
        host: parts[0],
        port: Number(parts[1])
      }
    })
  }

  // need to find the url of the latest **milestone** instead of the latest snapshot
  let url = await findLatestLangServerURL();


  return new Promise<void>((resolve, reject) => {
    let stream = got.stream(url, options)
      .on('downloadProgress', progress => {
        let p = (progress.percent * 100).toFixed(0)
        statusItem.text = `${p}% Downloading jdt.ls from eclipse.org`
      })
    compressing.tgz.uncompress(stream as any, root)
      .then(() => {
        statusItem.dispose()
        resolve()
      })
      .catch(e => {
        // tslint:disable-next-line: no-console
        console.error(e)
        statusItem.dispose()
        reject(e)
      })
  })
}
