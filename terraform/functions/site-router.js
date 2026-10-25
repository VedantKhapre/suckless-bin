/*
CloudFront Function to rewrite URLs for single-page application (SPA) routing.

- Changes /<6-10-letter-slug> to /paste/index.html
- Adds index.html to paths ending with /
- Adds /index.html to paths without a file extension
Example:
  /abcdef     → /paste/index.html
  /folder/    → /folder/index.html
  /folder     → /folder/index.html
 */


var SLUG = /^\/[A-Za-z]{6,10}\/?$/;

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (SLUG.test(uri)) {
    request.uri = "/paste/index.html";
  } else if (uri.charAt(uri.length - 1) === "/") {
    request.uri = uri + "index.html";
  } else if (uri.lastIndexOf(".") < uri.lastIndexOf("/")) {
    request.uri = uri + "/index.html";
  }
  
  return request;
}