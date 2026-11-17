import { createApp, h } from "vue";
import { RouterView } from "vue-router";
import { createAppRouter } from "./router";
import "./styles.css";

// ルート自体は App シェルを指すので、ここでは RouterView だけを置く。
createApp({ render: () => h(RouterView) }).use(createAppRouter()).mount("#app");
