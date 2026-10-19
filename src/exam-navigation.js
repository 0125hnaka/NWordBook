export function installExamSkipLink(document) {
  document.querySelector('.skip-link').addEventListener('click', event => {
    event.preventDefault();
    const main = document.querySelector('#main');
    main.scrollIntoView();
    main.focus({ preventScroll: true });
  });
}
