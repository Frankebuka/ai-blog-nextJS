// import styles from "./page.module.css";

import AddArticles from "./AddArticles";
import Articles from "./Articles";
import GenerateArticles from "./GenerateArticles";

export default function Home() {
  return (
    <main className="container">
      <div className="row" style={{ marginTop: 70 }}>
        <div className="col-md-8">
          <Articles />
        </div>
        <div className="col-md-4">
          <GenerateArticles />
          <AddArticles />
        </div>
      </div>
    </main>
  );
}
