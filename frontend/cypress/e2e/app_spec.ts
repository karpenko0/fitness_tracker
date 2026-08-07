describe('Fitness Tracker App', () => {
  it('loads the frontend', () => {
    cy.visit('http://localhost:3000')
    cy.contains('Fitness Tracker')
    cy.contains('Загрузка...').should('exist')
  })
})
