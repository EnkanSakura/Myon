/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** 由 middleware 在渲染页面前写入；API / 静态资源路径下不设置。 */
    site?: import('@myon/shared').PublicSiteSettings;
  }
}
