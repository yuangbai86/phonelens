"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** 导航只保留对比与数据说明；演示标识只出现在使用虚构数据的页面上 */
export function SiteNav() {
  const path = usePathname();
  return (
    <nav className="nav-links" aria-label="主导航">
      <Link href="/" aria-current={path === "/" || path.startsWith("/compare") ? "page" : undefined}>
        对比
      </Link>
      <Link href="/data" aria-current={path.startsWith("/data") ? "page" : undefined}>
        数据与方法
      </Link>
    </nav>
  );
}
