/**
 * @license Copyright (c) 2003-2017, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

import Editor from '@ckeditor/ckeditor5-core/src/editor/editor';
import Model from '@ckeditor/ckeditor5-engine/src/model/model';
import ListCommand from '../src/listcommand';
import Range from '@ckeditor/ckeditor5-engine/src/model/range';
import Position from '@ckeditor/ckeditor5-engine/src/model/position';
import { setData, getData } from '@ckeditor/ckeditor5-engine/src/dev-utils/model';

describe( 'ListCommand', () => {
	let editor, command, model, doc, root;

	beforeEach( () => {
		editor = new Editor();
		editor.model = new Model();

		model = editor.model;
		doc = model.document;
		root = doc.createRoot();

		command = new ListCommand( editor, 'bulleted' );

		model.schema.registerItem( 'listItem', '$block' );
		model.schema.registerItem( 'paragraph', '$block' );
		model.schema.registerItem( 'widget', '$block' );

		model.schema.allow( { name: '$block', inside: '$root' } );
		model.schema.allow( { name: 'paragraph', inside: 'widget' } );
		model.schema.allow( { name: 'listItem', attributes: [ 'type', 'indent' ], inside: '$root' } );
		model.schema.disallow( { name: 'listItem', attributes: [ 'type', 'indent' ], inside: 'widget' } );

		setData(
			model,
			'<paragraph>foo</paragraph>' +
			'<listItem type="bulleted" indent="0">bulleted</listItem>' +
			'<listItem type="numbered" indent="0">numbered</listItem>' +
			'<paragraph>bar</paragraph>' +
			'<widget>' +
				'<paragraph>xyz</paragraph>' +
			'</widget>'
		);

		doc.selection.setCollapsedAt( doc.getRoot().getChild( 0 ) );
	} );

	afterEach( () => {
		command.destroy();
	} );

	describe( 'ListCommand', () => {
		describe( 'constructor()', () => {
			it( 'should create list command with given type and value set to false', () => {
				expect( command.type ).to.equal( 'bulleted' );
				expect( command.value ).to.be.false;

				const numberedList = new ListCommand( editor, 'numbered' );
				expect( numberedList.type ).to.equal( 'numbered' );
			} );
		} );

		describe( 'value', () => {
			it( 'should be false if first position in selection is not in a list item', () => {
				model.change( () => {
					doc.selection.setCollapsedAt( doc.getRoot().getChild( 3 ) );
				} );

				expect( command.value ).to.be.false;
			} );

			it( 'should be false if first position in selection is in a list item of different type', () => {
				model.change( () => {
					doc.selection.setCollapsedAt( doc.getRoot().getChild( 2 ) );
				} );

				expect( command.value ).to.be.false;
			} );

			it( 'should be true if first position in selection is in a list item of same type', () => {
				model.change( () => {
					doc.selection.setCollapsedAt( doc.getRoot().getChild( 1 ) );
				} );

				expect( command.value ).to.be.true;
			} );
		} );

		describe( 'isEnabled', () => {
			it( 'should be true if entire selection is in a list', () => {
				setData( model, '<listItem type="bulleted" indent="0">[a]</listItem>' );
				expect( command.isEnabled ).to.be.true;
			} );

			it( 'should be true if entire selection is in a block which can be turned into a list', () => {
				setData( model, '<paragraph>[a]</paragraph>' );
				expect( command.isEnabled ).to.be.true;
			} );

			it( 'should be true if selection first position is in a block which can be turned into a list', () => {
				setData( model, '<paragraph>[a</paragraph><widget>b]</widget>' );
				expect( command.isEnabled ).to.be.true;
			} );

			it( 'should be false if selection first position is in an element which cannot be converted to a list item', () => {
				setData( model, '<widget><paragraph>[a</paragraph></widget><paragraph>b]</paragraph>' );
				expect( command.isEnabled ).to.be.false;
			} );

			it( 'should be false in a root which does not allow blocks at all', () => {
				doc.createRoot( 'paragraph', 'inlineOnlyRoot' );
				setData( model, 'a[]b', { rootName: 'inlineOnlyRoot' } );
				expect( command.isEnabled ).to.be.false;
			} );
		} );

		describe( 'execute()', () => {
			it( 'should use parent batch', () => {
				model.change( writer => {
					expect( writer.batch.deltas.length ).to.equal( 0 );

					command.execute();

					expect( writer.batch.deltas.length ).to.be.above( 0 );
				} );
			} );

			describe( 'collapsed selection', () => {
				it( 'should rename closest block to listItem and set correct attributes', () => {
					setData( model, '<paragraph>fo[]o</paragraph>' );

					command.execute();

					expect( getData( model ) ).to.equal( '<listItem indent="0" type="bulleted">fo[]o</listItem>' );
				} );

				it( 'should rename closest listItem to paragraph', () => {
					setData( model, '<listItem indent="0" type="bulleted">fo[]o</listItem>' );

					command.execute();

					// Attributes will be removed by post fixer.
					expect( getData( model ) ).to.equal( '<paragraph indent="0" type="bulleted">fo[]o</paragraph>' );
				} );

				it( 'should change closest listItem\' type', () => {
					setData( model, '<listItem indent="0" type="numbered">fo[]o</listItem>' );

					command.execute();

					expect( getData( model ) ).to.equal( '<listItem indent="0" type="bulleted">fo[]o</listItem>' );
				} );

				it( 'should handle outdenting sub-items when list item is turned off', () => {
					/* eslint-disable max-len */
					// Taken from docs.
					//
					// 1  * --------
					// 2     * --------
					// 3        * -------- <- this is turned off.
					// 4           * -------- <- this has to become indent = 0, because it will be first item on a new list.
					// 5              * -------- <- this should be still be a child of item above, so indent = 1.
					// 6        * -------- <- this also has to become indent = 0, because it shouldn't end up as a child of any of items above.
					// 7           * -------- <- this should be still be a child of item above, so indent = 1.
					// 8     * -------- <- this has to become indent = 0.
					// 9        * -------- <- this should still be a child of item above, so indent = 1.
					// 10          * -------- <- this should still be a child of item above, so indent = 2.
					// 11          * -------- <- this should still be at the same level as item above, so indent = 2.
					// 12 * -------- <- this and all below are left unchanged.
					// 13    * --------
					// 14       * --------
					//
					// After turning off "3", the list becomes:
					//
					// 1  * --------
					// 2     * --------
					//
					// 3  --------
					//
					// 4  * --------
					// 5     * --------
					// 6  * --------
					// 7     * --------
					// 8  * --------
					// 9     * --------
					// 10       * --------
					// 11       * --------
					// 12 * --------
					// 13    * --------
					// 14       * --------
					/* eslint-enable max-len */

					setData(
						model,
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<listItem indent="1" type="bulleted">---</listItem>' +
						'<listItem indent="2" type="bulleted">[]---</listItem>' +
						'<listItem indent="3" type="bulleted">---</listItem>' +
						'<listItem indent="4" type="bulleted">---</listItem>' +
						'<listItem indent="2" type="bulleted">---</listItem>' +
						'<listItem indent="3" type="bulleted">---</listItem>' +
						'<listItem indent="1" type="bulleted">---</listItem>' +
						'<listItem indent="2" type="bulleted">---</listItem>' +
						'<listItem indent="3" type="bulleted">---</listItem>' +
						'<listItem indent="3" type="bulleted">---</listItem>' +
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<listItem indent="1" type="bulleted">---</listItem>' +
						'<listItem indent="2" type="bulleted">---</listItem>'
					);

					command.execute();

					const expectedData =
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<listItem indent="1" type="bulleted">---</listItem>' +
						'<paragraph indent="2" type="bulleted">[]---</paragraph>' + // Attributes will be removed by post fixer.
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<listItem indent="1" type="bulleted">---</listItem>' +
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<listItem indent="1" type="bulleted">---</listItem>' +
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<listItem indent="1" type="bulleted">---</listItem>' +
						'<listItem indent="2" type="bulleted">---</listItem>' +
						'<listItem indent="2" type="bulleted">---</listItem>' +
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<listItem indent="1" type="bulleted">---</listItem>' +
						'<listItem indent="2" type="bulleted">---</listItem>';

					expect( getData( model ) ).to.equal( expectedData );
				} );
			} );

			describe( 'non-collapsed selection', () => {
				beforeEach( () => {
					setData(
						model,
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<paragraph>---</paragraph>' +
						'<paragraph>---</paragraph>' +
						'<listItem indent="0" type="numbered">---</listItem>' +
						'<listItem indent="0" type="numbered">---</listItem>' +
						'<listItem indent="1" type="bulleted">---</listItem>' +
						'<listItem indent="2" type="bulleted">---</listItem>'
					);
				} );

				// https://github.com/ckeditor/ckeditor5-list/issues/62
				it( 'should not rename blocks which cannot become listItems', () => {
					model.schema.registerItem( 'restricted' );
					model.schema.allow( { name: 'restricted', inside: '$root' } );
					model.schema.disallow( { name: 'paragraph', inside: 'restricted' } );

					model.schema.registerItem( 'fooBlock', '$block' );
					model.schema.allow( { name: 'fooBlock', inside: 'restricted' } );

					setData(
						model,
						'<paragraph>a[bc</paragraph>' +
						'<restricted><fooBlock></fooBlock></restricted>' +
						'<paragraph>de]f</paragraph>'
					);

					command.execute();

					expect( getData( model ) ).to.equal(
						'<listItem indent="0" type="bulleted">a[bc</listItem>' +
						'<restricted><fooBlock></fooBlock></restricted>' +
						'<listItem indent="0" type="bulleted">de]f</listItem>'
					);
				} );

				it( 'should rename closest block to listItem and set correct attributes', () => {
					// From first paragraph to second paragraph.
					// Command value=false, we are turning on list items.
					model.change( () => {
						doc.selection.setRanges( [ new Range(
							Position.createAt( root.getChild( 2 ) ),
							Position.createAt( root.getChild( 3 ), 'end' )
						) ] );
					} );

					command.execute();

					const expectedData =
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<listItem indent="0" type="bulleted">[---</listItem>' +
						'<listItem indent="0" type="bulleted">---]</listItem>' +
						'<listItem indent="0" type="numbered">---</listItem>' +
						'<listItem indent="0" type="numbered">---</listItem>' +
						'<listItem indent="1" type="bulleted">---</listItem>' +
						'<listItem indent="2" type="bulleted">---</listItem>';

					expect( getData( model ) ).to.equal( expectedData );
				} );

				it( 'should rename closest listItem to paragraph', () => {
					// From second bullet list item to first numbered list item.
					// Command value=true, we are turning off list items.
					model.change( () => {
						doc.selection.setRanges( [ new Range(
							Position.createAt( root.getChild( 1 ) ),
							Position.createAt( root.getChild( 4 ), 'end' )
						) ] );
					} );

					// Convert paragraphs, leave numbered list items.
					command.execute();

					const expectedData =
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<paragraph indent="0" type="bulleted">[---</paragraph>' + // Attributes will be removed by post fixer.
						'<paragraph>---</paragraph>' +
						'<paragraph>---</paragraph>' +
						'<paragraph indent="0" type="numbered">---]</paragraph>' + // Attributes will be removed by post fixer.
						'<listItem indent="0" type="numbered">---</listItem>' +
						'<listItem indent="1" type="bulleted">---</listItem>' +
						'<listItem indent="2" type="bulleted">---</listItem>';

					expect( getData( model ) ).to.equal( expectedData );
				} );

				it( 'should change closest listItem\'s type', () => {
					// From first numbered lsit item to third bulleted list item.
					model.change( () => {
						doc.selection.setRanges( [ new Range(
							Position.createAt( root.getChild( 4 ) ),
							Position.createAt( root.getChild( 6 ) )
						) ] );
					} );

					// Convert paragraphs, leave numbered list items.
					command.execute();

					const expectedData =
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<paragraph>---</paragraph>' +
						'<paragraph>---</paragraph>' +
						'<listItem indent="0" type="bulleted">[---</listItem>' +
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<listItem indent="1" type="bulleted">]---</listItem>' +
						'<listItem indent="2" type="bulleted">---</listItem>';

					expect( getData( model ) ).to.equal( expectedData );
				} );

				it( 'should handle outdenting sub-items when list item is turned off', () => {
					// From first numbered list item to third bulleted list item.
					model.change( () => {
						doc.selection.setRanges( [ new Range(
							Position.createAt( root.getChild( 1 ) ),
							Position.createAt( root.getChild( 5 ), 'end' )
						) ] );
					} );

					// Convert paragraphs, leave numbered list items.
					command.execute();

					const expectedData =
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<paragraph indent="0" type="bulleted">[---</paragraph>' + // Attributes will be removed by post fixer.
						'<paragraph>---</paragraph>' +
						'<paragraph>---</paragraph>' +
						'<paragraph indent="0" type="numbered">---</paragraph>' + // Attributes will be removed by post fixer.
						'<paragraph indent="0" type="numbered">---]</paragraph>' + // Attributes will be removed by post fixer.
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<listItem indent="1" type="bulleted">---</listItem>';

					expect( getData( model ) ).to.equal( expectedData );
				} );

				// Example from docs.
				it( 'should change type of all items in nested list if one of items changed', () => {
					setData(
						model,
						'<listItem indent="0" type="numbered">---</listItem>' +
						'<listItem indent="1" type="numbered">---</listItem>' +
						'<listItem indent="2" type="numbered">---</listItem>' +
						'<listItem indent="1" type="numbered">---</listItem>' +
						'<listItem indent="2" type="numbered">---</listItem>' +
						'<listItem indent="2" type="numbered">-[-</listItem>' +
						'<listItem indent="1" type="numbered">---</listItem>' +
						'<listItem indent="1" type="numbered">---</listItem>' +
						'<listItem indent="0" type="numbered">---</listItem>' +
						'<listItem indent="1" type="numbered">-]-</listItem>' +
						'<listItem indent="1" type="numbered">---</listItem>' +
						'<listItem indent="2" type="numbered">---</listItem>' +
						'<listItem indent="0" type="numbered">---</listItem>'
					);

					// * ------				<-- do not fix, top level item
					//   * ------			<-- fix, because latter list item of this item's list is changed
					//      * ------		<-- do not fix, item is not affected (different list)
					//   * ------			<-- fix, because latter list item of this item's list is changed
					//      * ------		<-- fix, because latter list item of this item's list is changed
					//      * ---[--		<-- already in selection
					//   * ------			<-- already in selection
					//   * ------			<-- already in selection
					// * ------				<-- already in selection, but does not cause other list items to change because is top-level
					//   * ---]--			<-- already in selection
					//   * ------			<-- fix, because preceding list item of this item's list is changed
					//      * ------		<-- do not fix, item is not affected (different list)
					// * ------				<-- do not fix, top level item

					command.execute();

					const expectedData =
						'<listItem indent="0" type="numbered">---</listItem>' +
						'<listItem indent="1" type="bulleted">---</listItem>' +
						'<listItem indent="2" type="numbered">---</listItem>' +
						'<listItem indent="1" type="bulleted">---</listItem>' +
						'<listItem indent="2" type="bulleted">---</listItem>' +
						'<listItem indent="2" type="bulleted">-[-</listItem>' +
						'<listItem indent="1" type="bulleted">---</listItem>' +
						'<listItem indent="1" type="bulleted">---</listItem>' +
						'<listItem indent="0" type="bulleted">---</listItem>' +
						'<listItem indent="1" type="bulleted">-]-</listItem>' +
						'<listItem indent="1" type="bulleted">---</listItem>' +
						'<listItem indent="2" type="numbered">---</listItem>' +
						'<listItem indent="0" type="numbered">---</listItem>';

					expect( getData( model ) ).to.equal( expectedData );
				} );
			} );
		} );
	} );
} );
