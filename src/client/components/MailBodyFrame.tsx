import {useMemo} from 'react';
import {frameDocument} from '../sanitize/html-allowlist';
export function MailBodyFrame({html}:{html:string}){
  const srcDoc=useMemo(()=>frameDocument(html),[html]);
  return <div className="body-frame"><iframe title="安全邮件正文" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={srcDoc}/></div>;
}
