import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { AgentAppDomain } from "./AgentAppDomain";
vi.mock("next/link",()=>({default:({children,href}:{children:React.ReactNode;href:string})=><a href={href}>{children}</a>}));
const fetchMock=vi.fn();let node:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset();node=document.createElement("div");document.body.appendChild(node);root=createRoot(node);});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();vi.unstubAllGlobals();});
it("does not fetch, publish or change infrastructure just by opening domain setup",async()=>{
 await act(async()=>root.render(<AgentAppDomain deploymentId="42"/>));
 expect(fetchMock).not.toHaveBeenCalled();expect(node.textContent).toContain("Cloudflare is not required");
 expect(node.textContent).toContain("No DNS, Azure network, firewall or proxy change");
 expect([...node.querySelectorAll("button")].find(x=>x.textContent==="Prepare domain")?.disabled).toBe(true);
});
it("requires hostname authority before domain preparation",async()=>{
 await act(async()=>root.render(<AgentAppDomain deploymentId="42"/>));
 await act(async()=>node.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
 expect(fetchMock).not.toHaveBeenCalled();
 expect([...node.querySelectorAll("button")].find(x=>x.textContent==="Prepare domain")?.disabled).toBe(true);
});
