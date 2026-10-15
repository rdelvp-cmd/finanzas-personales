import { redirect } from "next/navigation";
import { actual, ruta } from "@/lib/quincena";

export const dynamic = "force-dynamic";

export default function Home() {
  redirect(ruta(actual()));
}
