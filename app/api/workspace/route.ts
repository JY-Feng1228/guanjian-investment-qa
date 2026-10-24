import { handle } from "@/lib/api";
export const dynamic="force-dynamic";
export async function GET(request:Request) {return handle(request);}
